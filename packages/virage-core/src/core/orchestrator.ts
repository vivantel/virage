import { GitTracker } from "./git-tracker.js";
import { CliGitSourceRepository } from "./cli-git-source-repository.js";
import { ChunkProcessor } from "./chunk-processor.js";
import { EmbedderProcessor } from "./embedder.js";
import { Uploader } from "./uploader.js";
import { VirageDb } from "./virage-db.js";
import { TelemetryCollector } from "./telemetry.js";
import {
  ChunkerEntry,
  EmbeddingProvider,
  VectorStore,
  Chunk,
  EmbeddedChunk,
  EmbeddingsMeta,
} from "../interfaces/index.js";
import type { SourceRepository } from "../interfaces/source-repository.js";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import { availableParallelism } from "node:os";
import { RetryOptions, Semaphore, withConcurrency } from "./utils.js";
import { defaultVirageDb } from "./virage-defaults.js";
import type { TelemetryConfig } from "../telemetry/types.js";
import type { Reranker } from "../interfaces/reranker.js";
import type { QualityConfig } from "../interfaces/quality.js";

export interface RAGPipelineConfig {
  /** Flat list: one entry per (fileSet × chunker) pair (ADR-043). */
  fileSetEntries: ChunkerEntry[];
  embedder: EmbeddingProvider;
  vectorStore: VectorStore;
  sourceRepository?: SourceRepository;
  /** Global ignore patterns applied before routing files to any fileSet. */
  globalIgnore?: string[];
  telemetry?: TelemetryConfig;
  search?: {
    hybrid?: boolean;
    hybridAlpha?: number;
    reranker?: Reranker;
    /** Number of candidates to fetch per final result when a reranker is active. Default: 5. */
    rerankOversample?: number;
  };
  options?: {
    embeddingsFile?: string;
    force?: boolean;
    skipUpload?: boolean;
    dryRun?: boolean;
    rateLimitMs?: number;
    batchSize?: number;
    maxBatchChars?: number;
    retry?: RetryOptions;
    concurrency?: number;
    chunkConcurrency?: number;
    /** @deprecated Use minUploadingBatchSize instead. */
    minIngestionBatchSize?: number;
    /** Minimum pending-chunk queue size before triggering an embedding run. Default: 10. */
    minEmbeddingBatchSize?: number;
    /** Minimum embedded-chunk queue size before triggering an upload batch. Default: 20. */
    minUploadingBatchSize?: number;
    /** Max files whose chunks may be queued for embedding before chunk workers pause. Default: minEmbeddingBatchSize × 3. */
    maxPendingFiles?: number;
    noBanner?: boolean;
    telemetry?: boolean;
    notifications?: { webhookUrl?: string };
    logger?: Logger;
    onScanProgress?: (done: number, total: number) => void;
    onModelProgress?: (loaded: number, total: number) => void;
    onPreWarmStart?: () => void;
    onPreWarmDone?: () => void;
    onChunkProgress?: (done: number, total: number) => void;
    onEmbedProgress?: (done: number, total: number) => void;
    onUploadProgress?: (done: number, total: number) => void;
    onFileComplete?: (done: number, total: number) => void;
    onSkipProgress?: (skipped: number) => void;
    onChunkingComplete?: (
      files: number,
      bytes: number,
      durationMs: number,
    ) => void;
    onEmbeddingComplete?: (
      chunks: number,
      bytes: number,
      durationMs: number,
    ) => void;
  };
  quality?: QualityConfig;
}

async function notifyWebhook(
  url: string,
  status: "success" | "error",
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...payload }),
    });
  } catch {
    // Notification failures are non-fatal
  }
}

export class Orchestrator {
  private config: RAGPipelineConfig;
  private embeddingsFile: string;

  constructor(config: RAGPipelineConfig) {
    this.config = config;
    this.embeddingsFile = config.options?.embeddingsFile ?? defaultVirageDb();
  }

  async run(): Promise<{ filesProcessed: number; filesDeleted: number }> {
    const opts = this.config.options ?? {};
    const logger = (opts.logger ?? new NullLogger()).withTag("orchestrator");
    const telemetry = opts.telemetry ? new TelemetryCollector() : null;
    telemetry?.start();

    const db = new VirageDb(this.embeddingsFile);

    let uploadedCount = 0;
    let deletedCount = 0;

    logger.debug(
      `Config: embeddingsDb=${this.embeddingsFile} force=${opts.force ?? false}`,
    );

    try {
      logger.info("🚀 Starting RAG pipeline...");

      // Detect model/dimension change — triggers full re-embed
      const existingMeta = db.getMeta();
      let effectiveForce = opts.force || false;

      if (!effectiveForce && existingMeta) {
        const modelChanged =
          existingMeta.model !== undefined &&
          this.config.embedder.model !== undefined &&
          existingMeta.model !== this.config.embedder.model;
        const dimensionsChanged =
          existingMeta.providerDimensions != null &&
          this.config.embedder.dimensions != null &&
          existingMeta.providerDimensions !== this.config.embedder.dimensions;

        if (modelChanged || dimensionsChanged) {
          logger.warn(
            `⚠️ Embedding model changed — clearing DB and re-embedding all.`,
          );
          db.clearAll();
          effectiveForce = true;
        }
      }

      // Initialize vector store early — its current state is the authoritative
      // record of what is indexed, replacing SQLite's file_revisions for change detection.
      await this.config.vectorStore.initialize();

      // Git tracking
      logger.info("📂 Scanning for changes...");
      const t1 = Date.now();
      const globalIgnore = this.config.globalIgnore ?? [];
      const source =
        this.config.sourceRepository ??
        new CliGitSourceRepository(process.cwd(), opts.logger, globalIgnore);
      const gitTracker = new GitTracker(
        this.config.fileSetEntries,
        source,
        opts.logger,
        globalIgnore,
      );
      const [currentState, currentBranch, vectorStoreState] = await Promise.all(
        [
          gitTracker.getCurrentState(opts.onScanProgress),
          gitTracker.getCurrentBranch(),
          this.config.vectorStore.getCurrentState(),
        ],
      );

      const previousState = effectiveForce
        ? new Map<string, string>()
        : new Map([...db.getFileStates(), ...vectorStoreState]);

      const { toProcess, toDelete, unchanged } =
        await gitTracker.getChangedFiles(previousState, currentState);

      const gitDuration = Date.now() - t1;
      logger.verbose(`Git tracking done in ${gitDuration}ms`);
      telemetry?.recordGitTracking({
        durationMs: gitDuration,
        filesScanned: currentState.size,
        toProcess: toProcess.length,
        toDelete: toDelete.length,
      });

      // Load resume queues — exclude files that will be re-processed this run
      const skipSet = new Set([...toProcess, ...toDelete]);
      const pendingEmbed: Chunk[] = db
        .getPendingEmbedChunks()
        .filter((c) => !skipSet.has(c.sourceFile));
      const pendingUpload: EmbeddedChunk[] = db
        .getPendingUploadChunks()
        .filter((c) => !skipSet.has(c.sourceFile));

      if (
        toProcess.length === 0 &&
        toDelete.length === 0 &&
        pendingEmbed.length === 0 &&
        pendingUpload.length === 0 &&
        !effectiveForce
      ) {
        logger.info("✨ No changes detected.");
        return { filesProcessed: 0, filesDeleted: 0 };
      }

      logger.info(
        `📊 ${toProcess.length} to process, ${toDelete.length} to delete` +
          (unchanged.length > 0 ? `, ${unchanged.length} unchanged` : "") +
          (pendingEmbed.length > 0
            ? `, ${pendingEmbed.length} embed-pending`
            : "") +
          (pendingUpload.length > 0
            ? `, ${pendingUpload.length} upload-pending`
            : ""),
      );

      // Whether the vector store can do targeted per-file orphan cleanup.
      // When true, toProcess files are NOT pre-deleted; instead stale chunks are
      // removed after upload via deleteOrphanedChunks (preserving cached hits).
      const hasOrphanCleanup =
        typeof this.config.vectorStore.deleteOrphanedChunks === "function";
      const fileNewHashes = new Map<string, string[]>();

      // Delete stale vector store entries before producing new ones
      const uploader = new Uploader(this.config.vectorStore, {
        retry: opts.retry,
        logger: opts.logger,
      });

      if (!opts.skipUpload && !opts.dryRun) {
        await uploader.prepareUpdate(
          db,
          toDelete,
          hasOrphanCleanup ? [] : toProcess,
          effectiveForce,
        );
        deletedCount = toDelete.length;
      }

      for (const file of toDelete) {
        db.deleteBySourceFile(file);
      }

      // Pre-warm the embedding model so loading time is separate from pipeline progress
      if (typeof this.config.embedder.preWarm === "function") {
        opts.onPreWarmStart?.();
        await this.config.embedder.preWarm(opts.onModelProgress);
        opts.onPreWarmDone?.();
      } else {
        opts.onPreWarmDone?.();
      }

      // Streaming loop configuration
      const minEmbedBatch = opts.minEmbeddingBatchSize ?? 10;
      const minUploadBatch =
        opts.minUploadingBatchSize ?? opts.minIngestionBatchSize ?? 20;

      let embedTotal = pendingEmbed.length;
      let chunkDone = 0;
      let embedDone = 0;
      let uploadDone = 0;

      // Snapshot carry-over counts for projection arithmetic below.
      const initialPendingEmbed = pendingEmbed.length;
      const initialPendingUpload = pendingUpload.length;

      // Shared projected total used by both embed and upload bars so they always
      // show the same denominator — avoids the "Embedding: 50/300, Uploading: 50/5120" confusion.
      let sharedTotal = Math.max(initialPendingEmbed, initialPendingUpload, 1);

      opts.onChunkProgress?.(0, toProcess.length);
      opts.onEmbedProgress?.(0, sharedTotal);
      opts.onUploadProgress?.(0, sharedTotal);

      const chunkProcessor = new ChunkProcessor(opts.logger);
      const embedder = new EmbedderProcessor(this.config.embedder, {
        rateLimitMs: opts.rateLimitMs,
        batchSize: opts.batchSize,
        maxBatchChars: opts.maxBatchChars,
        retry: opts.retry,
        concurrency: opts.concurrency,
        vectorStoreName: this.config.vectorStore.name,
        logger: opts.logger,
      });

      // Build meta once; stored to DB after the first embedding batch
      const now = Math.floor(Date.now() / 1000);
      const newMeta: EmbeddingsMeta = {
        schemaVersion: 1,
        providerName: this.config.embedder.name,
        providerDimensions: this.config.embedder.dimensions,
        ...(this.config.embedder.model !== undefined
          ? { model: this.config.embedder.model }
          : {}),
        ...(this.config.vectorStore.name !== undefined
          ? { vectorStoreName: this.config.vectorStore.name }
          : {}),
        createdAt: existingMeta?.createdAt ?? now,
        updatedAt: now,
      };

      let chunksGenerated = 0;
      let chunksEmbedded = 0;
      let totalSkipped = 0;
      let totalChunkBytes = 0;
      let totalEmbedBytes = 0;
      const t2 = Date.now();

      let filesIndexed = 0;

      const flushUpload = async (all: boolean) => {
        if (opts.skipUpload || opts.dryRun) return;
        const limit = all ? pendingUpload.length : minUploadBatch;
        while (pendingUpload.length >= (all ? 1 : minUploadBatch)) {
          const ubatch = pendingUpload.splice(0, limit);
          await uploader.upsertBatch(db, ubatch);
          uploadDone += ubatch.length;
          uploadedCount += ubatch.length;
          opts.onUploadProgress?.(uploadDone, sharedTotal);
        }
      };

      const flushEmbed = async (all: boolean) => {
        const limit = all ? pendingEmbed.length : minEmbedBatch;
        while (pendingEmbed.length >= (all ? 1 : minEmbedBatch)) {
          const batch = pendingEmbed.splice(0, limit);
          logger.debug(
            `[embed] ${batch.length} chunk(s) → ${this.config.embedder.name}`,
          );
          const embedded = await embedder.embedChunks(batch);
          const embeddedAt = Math.floor(Date.now() / 1000);
          for (const chunk of embedded) {
            db.updateDenseVector(
              chunk.denseTextHash,
              chunk.denseVector,
              embeddedAt,
            );
          }
          db.setMeta(newMeta);
          pendingUpload.push(...embedded);
          embedDone += batch.length;
          chunksEmbedded += batch.length;
          opts.onEmbedProgress?.(embedDone, sharedTotal);
          await flushUpload(false);
        }
      };

      // Chunk files concurrently, streaming each file's chunks into embed/upload.
      // A Semaphore limits how many files' chunks can be queued ahead of embedding,
      // creating real back pressure: chunk workers block when the embed queue is full.
      const chunkConcurrency = opts.chunkConcurrency ?? availableParallelism();
      const maxPendingFiles = opts.maxPendingFiles ?? minEmbedBatch * 3;
      const embedSemaphore = new Semaphore(maxPendingFiles);
      let filesStreamed = 0;
      let embedChain = Promise.resolve();
      let firstEmbedError: Error | undefined;

      const chunkTasks = toProcess.map((file) => async () => {
        const info = currentState.get(file);
        let newChunks: Chunk[] = [];
        if (info) {
          try {
            newChunks = await chunkProcessor.processEntries(
              file,
              info.commitHash,
              info.entries,
            );
            void currentBranch; // branch tracking removed from ChunkMeta
          } catch (err) {
            logger.error(
              `❌ Chunking failed for ${file}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
        opts.onChunkProgress?.(++chunkDone, toProcess.length);

        // Block when the embed queue is full — yields the event loop to embedChain.
        await embedSemaphore.acquire();

        const capturedChunks = newChunks;
        embedChain = embedChain.then(async () => {
          if (firstEmbedError) {
            embedSemaphore.release();
            return;
          }
          try {
            filesStreamed++;
            totalChunkBytes += capturedChunks.reduce(
              (s, c) => s + c.denseText.length,
              0,
            );
            db.replaceChunks(file, capturedChunks, info?.commitHash);
            if (hasOrphanCleanup) {
              fileNewHashes.set(
                file,
                capturedChunks.map((c) => c.denseTextHash),
              );
            }

            // Check which hashes already exist in the vector store — skip re-embedding.
            // Batch size is 2× minEmbedBatch to amortise the round-trip cost.
            // Skipped when effectiveForce=true: force means re-embed everything.
            const hashCheckBatchSize = minEmbedBatch * 2;
            const existingSet = new Set<string>();
            if (!effectiveForce) {
              if (
                typeof this.config.vectorStore.existingHashes === "function"
              ) {
                const hashes = capturedChunks.map((c) => c.denseTextHash);
                for (let i = 0; i < hashes.length; i += hashCheckBatchSize) {
                  const slice = hashes.slice(i, i + hashCheckBatchSize);
                  const found =
                    await this.config.vectorStore.existingHashes(slice);
                  for (const h of found) existingSet.add(h);
                }
              } else {
                // Fallback: SQLite in-session check (no cross-run caching)
                const alreadyEmbedded = db.getEmbeddedDenseTextHashes(file);
                for (const h of alreadyEmbedded) existingSet.add(h);
              }
            }

            const chunksToEmbed = capturedChunks.filter(
              (c) => !existingSet.has(c.denseTextHash),
            );
            const fileSkipped = capturedChunks.length - chunksToEmbed.length;
            totalSkipped += fileSkipped;
            if (fileSkipped > 0) opts.onSkipProgress?.(totalSkipped);

            totalEmbedBytes += chunksToEmbed.reduce(
              (s, c) => s + c.denseText.length,
              0,
            );
            pendingEmbed.push(...chunksToEmbed);
            embedTotal += chunksToEmbed.length;
            chunksGenerated += chunksToEmbed.length;

            if (chunksGenerated > 0) {
              const avgChunksPerFile = chunksGenerated / filesStreamed;
              const projectedNew = Math.round(
                toProcess.length * avgChunksPerFile,
              );
              sharedTotal = initialPendingEmbed + Math.max(projectedNew, 1);
              opts.onEmbedProgress?.(embedDone, sharedTotal);
              opts.onUploadProgress?.(uploadDone, sharedTotal);
            }

            await flushEmbed(false);
            // Fire once per file after embedding is queued. embedChain runs
            // sequentially with awaits between files so the renderer timer can
            // render each increment, giving smooth 1/N → N/N progress.
            opts.onFileComplete?.(++filesIndexed, toProcess.length);
          } catch (err) {
            firstEmbedError =
              err instanceof Error ? err : new Error(String(err));
            logger.error(
              `❌ Embed chain error for ${file}: ${firstEmbedError.message}`,
            );
          } finally {
            embedSemaphore.release();
          }
        });
      });

      await withConcurrency(chunkTasks, chunkConcurrency);
      // Wait for any in-flight embed/upload work that started during chunking
      await embedChain;

      if (firstEmbedError) {
        throw firstEmbedError;
      }

      const chunkDuration = Date.now() - t2;
      opts.onChunkingComplete?.(
        toProcess.length,
        totalChunkBytes,
        chunkDuration,
      );
      telemetry?.recordChunking({
        durationMs: chunkDuration,
        filesProcessed: toProcess.length,
        chunksGenerated,
        errors: 0,
      });

      // All chunking done — switch to actual total for final flush progress
      sharedTotal = Math.max(embedTotal, 1);

      // Flush remaining pending embed and upload
      const t3 = Date.now();
      await flushEmbed(true);
      const embedDuration = Date.now() - t3;
      opts.onEmbeddingComplete?.(
        chunksEmbedded,
        totalEmbedBytes,
        embedDuration,
      );

      const t4 = Date.now();
      await flushUpload(true);
      const uploadDuration = Date.now() - t4;

      if (!opts.skipUpload && !opts.dryRun) {
        if (hasOrphanCleanup && !effectiveForce) {
          for (const [file, hashes] of fileNewHashes) {
            await this.config.vectorStore.deleteOrphanedChunks!(file, hashes);
          }
        }
        await this.config.vectorStore.writeMeta?.({
          providerName: this.config.embedder.name,
          model: this.config.embedder.model,
          dimensions: this.config.embedder.dimensions,
          distanceMetric: "cosine",
          createdAt: Math.floor(Date.now() / 1000),
        });
      }

      logger.info(
        `📦 Embedded ${chunksEmbedded} chunk(s)` +
          (totalSkipped > 0 ? `, skipped ${totalSkipped} (cached)` : ""),
      );
      telemetry?.recordEmbedding({
        durationMs: embedDuration,
        chunksEmbedded,
        chunksSkipped: totalSkipped,
      });

      if (!opts.skipUpload && !opts.dryRun) {
        telemetry?.recordUpload({
          durationMs: uploadDuration,
          uploaded: uploadedCount,
          deleted: deletedCount,
        });
      }

      if (opts.dryRun) {
        logger.info("📤 Upload (dry-run — no changes written)");
        logger.info(
          `   Would upload: ${uploadDone + pendingUpload.length} document(s)`,
        );
        logger.info(
          `   Would delete: ${toDelete.length + toProcess.length} source file(s)`,
        );
      }

      if (telemetry) {
        telemetry.finish();
        telemetry.printSummary(opts.logger);
        await telemetry.save(db, opts.logger);
      }

      if (opts.notifications?.webhookUrl) {
        await notifyWebhook(opts.notifications.webhookUrl, "success", {
          durationMs: telemetry?.getData().durationMs,
          stages: telemetry?.getData().stages,
          uploaded: uploadedCount,
          deleted: deletedCount,
        });
      }

      return {
        filesProcessed: toProcess.length,
        filesDeleted: toDelete.length,
      };
    } catch (err) {
      telemetry?.finish();

      if (opts.notifications?.webhookUrl) {
        await notifyWebhook(opts.notifications.webhookUrl, "error", {
          error: err instanceof Error ? err.message : String(err),
          durationMs: telemetry?.getData().durationMs,
        });
      }

      throw err;
    } finally {
      db.close();
    }
  }
}
