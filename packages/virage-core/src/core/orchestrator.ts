import { GitTracker } from "./git-tracker.js";
import { ChunkProcessor } from "./chunk-processor.js";
import { EmbedderProcessor } from "./embedder.js";
import { Uploader } from "./uploader.js";
import { EmbeddingsDb } from "./embeddings-db.js";
import { TelemetryCollector } from "./telemetry.js";
import {
  createProgressBar,
  type ProgressBar,
} from "../progress/progress-bar.js";
import {
  FileChunker,
  EmbeddingProvider,
  VectorStore,
  Chunk,
} from "../interfaces/index.js";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import { readFile } from "fs/promises";
import { RetryOptions } from "./utils.js";
import { defaultChunksFile, defaultEmbeddingsFile } from "./virage-defaults.js";

export interface RAGPipelineConfig {
  chunkers: FileChunker[];
  embedder: EmbeddingProvider;
  vectorStore: VectorStore;
  options?: {
    chunksFile?: string;
    embeddingsFile?: string;
    force?: boolean;
    skipUpload?: boolean;
    dryRun?: boolean;
    rateLimitMs?: number;
    batchSize?: number;
    maxBatchChars?: number;
    retry?: RetryOptions;
    concurrency?: number;
    minIngestionBatchSize?: number;
    telemetry?: boolean;
    notifications?: { webhookUrl?: string };
    logger?: Logger;
  };
}

function loadPreviousState(db: EmbeddingsDb): Map<string, string> {
  const state = new Map<string, string>();
  for (const chunk of db.getAll()) {
    if (chunk.sourceFile && chunk.commitHash) {
      state.set(chunk.sourceFile, chunk.commitHash);
    }
  }
  return state;
}

async function loadExistingChunks(chunksFile: string): Promise<Chunk[]> {
  try {
    const content = await readFile(chunksFile, "utf-8");
    const parsed: unknown = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as Chunk[]) : [];
  } catch {
    return [];
  }
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
  private chunksFile: string;
  private embeddingsFile: string;

  constructor(config: RAGPipelineConfig) {
    this.config = config;
    this.chunksFile = config.options?.chunksFile ?? defaultChunksFile();
    this.embeddingsFile =
      config.options?.embeddingsFile ?? defaultEmbeddingsFile();
  }

  async run(): Promise<void> {
    const opts = this.config.options ?? {};
    const logger = (opts.logger ?? new NullLogger()).withTag("orchestrator");
    const telemetry = opts.telemetry ? new TelemetryCollector() : null;
    telemetry?.start();

    const dbPath = this.embeddingsFile.replace(/\.json$/, ".db");
    const db = new EmbeddingsDb(dbPath);

    let uploadStats = { uploaded: 0, deleted: 0 };

    logger.debug(
      `Config: chunksFile=${this.chunksFile} embeddingsFile=${this.embeddingsFile} force=${opts.force ?? false}`,
    );

    try {
      logger.info("🚀 Starting RAG pipeline...");

      // Step 1: Scan for changes
      logger.info("📂 Step 1: Scanning for changes...");
      const t1 = Date.now();
      const gitTracker = new GitTracker(this.config.chunkers, opts.logger);
      const currentState = await gitTracker.getCurrentState();

      const previousState = opts.force
        ? new Map<string, string>()
        : loadPreviousState(db);

      const { toProcess, toDelete } = await gitTracker.getChangedFiles(
        previousState,
        currentState,
      );

      const gitDuration = Date.now() - t1;
      logger.verbose(`Git tracking done in ${gitDuration}ms`);

      telemetry?.recordGitTracking({
        durationMs: gitDuration,
        filesScanned: currentState.size,
        toProcess: toProcess.length,
        toDelete: toDelete.length,
      });

      if (toProcess.length === 0 && toDelete.length === 0 && !opts.force) {
        logger.info("✨ No changes detected.");
        db.close();
        return;
      }

      logger.info(
        `📊 Changes: ${toProcess.length} to process, ${toDelete.length} to delete`,
      );

      // Step 2: Generate chunks (with resume)
      logger.info("🔪 Step 2: Generating chunks...");
      const t2 = Date.now();
      const chunkProcessor = new ChunkProcessor(
        this.config.chunkers,
        opts.logger,
      );

      const fileState = new Map<
        string,
        { commitHash: string; chunker: FileChunker }
      >();
      for (const file of toProcess) {
        const info = currentState.get(file);
        if (info) fileState.set(file, info);
      }

      const existingChunks = opts.force
        ? []
        : await loadExistingChunks(this.chunksFile);

      const chunkBar = createProgressBar("Chunking", toProcess.length);
      const chunks = await chunkProcessor.processFiles(
        toProcess,
        fileState,
        existingChunks,
        (done, total) => chunkBar.update(done < total ? done : total),
      );
      chunkBar.stop();
      await chunkProcessor.saveChunksLocal(chunks, this.chunksFile);

      const chunkDuration = Date.now() - t2;
      logger.verbose(`Chunking done in ${chunkDuration}ms`);

      telemetry?.recordChunking({
        durationMs: chunkDuration,
        filesProcessed: toProcess.length,
        chunksGenerated: chunks.length,
        errors: 0,
      });

      if (chunks.length === 0) {
        logger.warn("⚠️ No chunks generated. Exiting.");
        db.close();
        return;
      }

      // Step 3: Generate embeddings
      logger.info("🔢 Step 3: Generating embeddings...");
      const t3 = Date.now();
      const embedBars: ProgressBar[] = [];

      const uploader = new Uploader(this.config.vectorStore, {
        retry: opts.retry,
        logger: opts.logger,
      });

      const embedder = new EmbedderProcessor(this.config.embedder, {
        rateLimitMs: opts.rateLimitMs,
        batchSize: opts.batchSize,
        maxBatchChars: opts.maxBatchChars,
        retry: opts.retry,
        concurrency: opts.concurrency,
        vectorStoreName: this.config.vectorStore.name,
        minIngestionBatchSize: opts.minIngestionBatchSize,
        logger: opts.logger,
        onProgress: (done, total) => {
          if (embedBars.length === 0)
            embedBars.push(createProgressBar("Embedding", total));
          embedBars[0].update(done < total ? done : total);
        },
      });

      const newEmbeddings = await embedder.run(
        db,
        this.chunksFile,
        opts.force || false,
        opts.skipUpload
          ? undefined
          : async () => {
              await uploader.uploadPending(db);
            },
      );
      embedBars[0]?.stop();

      const embedDuration = Date.now() - t3;
      logger.verbose(`Embedding done in ${embedDuration}ms`);

      telemetry?.recordEmbedding({
        durationMs: embedDuration,
        chunksEmbedded: newEmbeddings.length,
        chunksSkipped: chunks.length - newEmbeddings.length,
      });

      // Step 4: Upload
      if (opts.dryRun) {
        const { toUpload: dryUpload, toDelete: dryDelete } =
          await uploader.getItemsToUpload(db, opts.force || false);
        logger.info("📤 Step 4: Upload (dry-run — no changes written)");
        logger.info(`   Would upload: ${dryUpload.length} document(s)`);
        logger.info(`   Would delete: ${dryDelete.length} source file(s)`);
      } else if (!opts.skipUpload) {
        logger.info("📤 Step 4: Uploading to vector store...");
        const t4 = Date.now();
        uploadStats = await uploader.sync(db, opts.force || false);

        const uploadDuration = Date.now() - t4;
        logger.verbose(`Upload done in ${uploadDuration}ms`);

        telemetry?.recordUpload({
          durationMs: uploadDuration,
          uploaded: uploadStats.uploaded,
          deleted: uploadStats.deleted,
        });
      }

      logger.success("✨ RAG pipeline complete!");

      if (telemetry) {
        telemetry.finish();
        telemetry.printSummary(opts.logger);
        const telemetryFile = this.chunksFile.replace(
          "chunks.json",
          "telemetry.json",
        );
        await telemetry.save(telemetryFile, opts.logger);
      }

      if (opts.notifications?.webhookUrl) {
        await notifyWebhook(opts.notifications.webhookUrl, "success", {
          durationMs: telemetry?.getData().durationMs,
          stages: telemetry?.getData().stages,
          uploaded: uploadStats.uploaded,
          deleted: uploadStats.deleted,
        });
      }
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
