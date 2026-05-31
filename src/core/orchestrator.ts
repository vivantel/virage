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
import { readFile } from "fs/promises";
import { RetryOptions } from "./utils.js";

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
  };
}

async function loadPreviousState(
  chunksFile: string,
): Promise<Map<string, string>> {
  try {
    const content = await readFile(chunksFile, "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return new Map();
    const state = new Map<string, string>();
    for (const chunk of parsed as Chunk[]) {
      if (chunk.sourceFile && chunk.commitHash) {
        state.set(chunk.sourceFile, chunk.commitHash);
      }
    }
    return state;
  } catch {
    return new Map();
  }
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
    const telemetry = opts.telemetry ? new TelemetryCollector() : null;
    telemetry?.start();

    let uploadStats = { uploaded: 0, deleted: 0 };

    try {
      console.log("🚀 Starting RAG pipeline...\n");

      // Step 1: Scan for changes
      console.log("📂 Step 1: Scanning for changes...");
      const t1 = Date.now();
      const gitTracker = new GitTracker(this.config.chunkers);
      const currentState = await gitTracker.getCurrentState();

      const previousState = opts.force
        ? new Map<string, string>()
        : await loadPreviousState(this.chunksFile);

      const { toProcess, toDelete } =
        await gitTracker.getChangedFiles(previousState);

      telemetry?.recordGitTracking({
        durationMs: Date.now() - t1,
        filesScanned: currentState.size,
        toProcess: toProcess.length,
        toDelete: toDelete.length,
      });

      if (toProcess.length === 0 && toDelete.length === 0 && !opts.force) {
        console.log("\n✨ No changes detected.");
        return;
      }

      console.log(
        `\n📊 Changes: ${toProcess.length} to process, ${toDelete.length} to delete\n`,
      );

      // Step 2: Generate chunks (with resume)
      console.log("🔪 Step 2: Generating chunks...");
      const t2 = Date.now();
      const chunkProcessor = new ChunkProcessor(this.config.chunkers);

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

      telemetry?.recordChunking({
        durationMs: Date.now() - t2,
        filesProcessed: toProcess.length,
        chunksGenerated: chunks.length,
        errors: 0,
      });

      if (chunks.length === 0) {
        console.log("\n⚠️ No chunks generated. Exiting.");
        return;
      }

      // Step 3: Generate embeddings
      console.log("\n🔢 Step 3: Generating embeddings...");
      const t3 = Date.now();
      const embedder = new EmbedderProcessor(this.config.embedder, {
        rateLimitMs: opts.rateLimitMs,
        batchSize: opts.batchSize,
        maxBatchChars: opts.maxBatchChars,
        retry: opts.retry,
        concurrency: opts.concurrency,
      });

      const newEmbeddings = await embedder.run(
        this.chunksFile,
        opts.force || false,
      );

      telemetry?.recordEmbedding({
        durationMs: Date.now() - t3,
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
        console.log("\n📤 Step 4: Upload (dry-run — no changes written)");
        console.log(`   Would upload: ${dryUpload.length} document(s)`);
        console.log(`   Would delete: ${dryDelete.length} source file(s)`);
      } else if (!opts.skipUpload) {
        console.log("\n📤 Step 4: Uploading to vector store...");
        const t4 = Date.now();
        const uploader = new Uploader(this.config.vectorStore, {
          retry: opts.retry,
        });
        uploadStats = await uploader.sync(
          this.embeddingsFile,
          opts.force || false,
        );

        telemetry?.recordUpload({
          durationMs: Date.now() - t4,
          uploaded: uploadStats.uploaded,
          deleted: uploadStats.deleted,
        });
      }

      console.log("\n✨ RAG pipeline complete!");

      if (telemetry) {
        telemetry.finish();
        telemetry.printSummary();
        const telemetryFile = this.chunksFile.replace(
          "chunks.json",
          "telemetry.json",
        );
        await telemetry.save(telemetryFile);
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
