import { GitTracker } from "./git-tracker.js";
import { ChunkProcessor } from "./chunk-processor.js";
import { EmbedderProcessor } from "./embedder.js";
import { Uploader } from "./uploader.js";
import {
  FileChunker,
  EmbeddingProvider,
  VectorStore,
  Chunk,
} from "../interfaces/index.js";
import { readFile } from "fs/promises";

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
    console.log("🚀 Starting RAG pipeline...\n");

    console.log("📂 Step 1: Scanning for changes...");
    const gitTracker = new GitTracker(this.config.chunkers);
    const currentState = await gitTracker.getCurrentState();

    const previousState = this.config.options?.force
      ? new Map<string, string>()
      : await loadPreviousState(this.chunksFile);

    const { toProcess, toDelete } =
      await gitTracker.getChangedFiles(previousState);

    if (
      toProcess.length === 0 &&
      toDelete.length === 0 &&
      !this.config.options?.force
    ) {
      console.log("\n✨ No changes detected.");
      return;
    }

    console.log(
      `\n📊 Changes: ${toProcess.length} to process, ${toDelete.length} to delete\n`,
    );

    console.log("🔪 Step 2: Generating chunks...");
    const chunkProcessor = new ChunkProcessor(this.config.chunkers);

    const fileState = new Map();
    for (const file of toProcess) {
      const info = currentState.get(file);
      if (info) fileState.set(file, info);
    }

    const chunks = await chunkProcessor.processFiles(toProcess, fileState);
    await chunkProcessor.saveChunksLocal(chunks, this.chunksFile);

    if (chunks.length === 0) {
      console.log("\n⚠️ No chunks generated. Exiting.");
      return;
    }

    console.log("\n🔢 Step 3: Generating embeddings...");
    const embedder = new EmbedderProcessor(this.config.embedder, {
      rateLimitMs: this.config.options?.rateLimitMs,
      batchSize: this.config.options?.batchSize,
    });

    await embedder.run(this.chunksFile, this.config.options?.force || false);

    if (this.config.options?.dryRun) {
      const uploader = new Uploader(this.config.vectorStore);
      const { toUpload, toDelete } = await uploader.getItemsToUpload(
        this.embeddingsFile,
        this.config.options?.force || false,
      );
      console.log("\n📤 Step 4: Upload (dry-run — no changes written)");
      console.log(`   Would upload: ${toUpload.length} document(s)`);
      console.log(`   Would delete: ${toDelete.length} source file(s)`);
    } else if (!this.config.options?.skipUpload) {
      console.log("\n📤 Step 4: Uploading to vector store...");
      const uploader = new Uploader(this.config.vectorStore);
      await uploader.sync(
        this.embeddingsFile,
        this.config.options?.force || false,
      );
    }

    console.log("\n✨ RAG pipeline complete!");
  }
}
