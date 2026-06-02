import { GitTracker } from "./git-tracker.js";
import { ChunkProcessor } from "./chunk-processor.js";
import { EmbedderProcessor } from "./embedder.js";
import { Uploader } from "./uploader.js";
import { TelemetryCollector } from "./telemetry.js";
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
import { readEmbeddingsFile } from "./embeddings-io.js";

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
    telemetry?: boolean;
    notifications?: { webhookUrl?: string };
    logger?: Logger;
  };
}

async function loadPreviousState(
  embeddingsFile: string,
): Promise<Map<string, string>> {
  const { chunks } = await readEmbeddingsFile(embeddingsFile);
  const state = new Map<string, string>();
  for (const chunk of chunks) {
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
    this.chunksFile = config.options?.chunksFile || "./docs/rag/chunks.json";
    this.embeddingsFile =
      config.options?.embeddingsFile || "./docs/rag/embeddings.json";
  }

  async run(): Promise<void> {
    const opts = this.config.options ?? {};
    const logger = (opts.logger ?? new NullLogger()).withTag("orchestrator");
    const telemetry = opts.telemetry ? new TelemetryCollector() : null;
    telemetry?.start();

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
        : await loadPreviousState(this.embeddingsFile);

      const { toProcess, toDelete } =
        await gitTracker.getChangedFiles(previousState);

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

      const chunks = await chunkProcessor.processFiles(
        toProcess,
        fileState,
        existingChunks,
      );
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
        return;
      }

      // Step 3: Generate embeddings
      logger.info("🔢 Step 3: Generating embeddings...");
      const t3 = Date.now();
      const embedder = new EmbedderProcessor(this.config.embedder, {
        rateLimitMs: opts.rateLimitMs,
        batchSize: opts.batchSize,
        maxBatchChars: opts.maxBatchChars,
        retry: opts.retry,
        concurrency: opts.concurrency,
        vectorStoreName: this.config.vectorStore.name,
        logger: opts.logger,
      });

      const newEmbeddings = await embedder.run(
        this.chunksFile,
        opts.force || false,
      );

      const embedDuration = Date.now() - t3;
      logger.verbose(`Embedding done in ${embedDuration}ms`);

      telemetry?.recordEmbedding({
        durationMs: embedDuration,
        chunksEmbedded: newEmbeddings.length,
        chunksSkipped: chunks.length - newEmbeddings.length,
      });

      // Step 4: Upload
      if (opts.dryRun) {
        const uploader = new Uploader(this.config.vectorStore);
        const { toUpload: dryUpload, toDelete: dryDelete } =
          await uploader.getItemsToUpload(
            this.embeddingsFile,
            opts.force || false,
          );
        logger.info("📤 Step 4: Upload (dry-run — no changes written)");
        logger.info(`   Would upload: ${dryUpload.length} document(s)`);
        logger.info(`   Would delete: ${dryDelete.length} source file(s)`);
      } else if (!opts.skipUpload) {
        logger.info("📤 Step 4: Uploading to vector store...");
        const t4 = Date.now();
        const uploader = new Uploader(this.config.vectorStore, {
          retry: opts.retry,
          logger: opts.logger,
        });
        uploadStats = await uploader.sync(
          this.embeddingsFile,
          opts.force || false,
        );

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
    }
  }
}
