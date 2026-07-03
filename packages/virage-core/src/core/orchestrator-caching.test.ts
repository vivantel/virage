import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { Orchestrator, type RAGPipelineConfig } from "./orchestrator.js";
import type {
  VectorStore,
  VectorDocument,
  VectorSearchResult,
  EmbeddingProvider,
  ChunkerEntry,
  Chunk,
} from "../interfaces/index.js";

// Minimal in-memory vector store — persists across orchestrator runs via shared instance.
// Implements existingHashes + deleteOrphanedChunks so the chunk-level dedup path is live.
class InMemoryStore implements VectorStore {
  readonly name = "in-memory-test";
  private docs = new Map<string, { sourceFile: string; commitHash: string }>();

  async initialize(): Promise<void> {}

  async upsert(documents: VectorDocument[]): Promise<void> {
    for (const d of documents) {
      const id = d.id ?? d.denseTextHash;
      this.docs.set(id, { sourceFile: d.sourceFile, commitHash: d.commitHash });
    }
  }

  async deleteBySourceFile(files: string[]): Promise<void> {
    const fSet = new Set(files);
    const toRemove = [...this.docs.entries()]
      .filter(([, v]) => fSet.has(v.sourceFile))
      .map(([k]) => k);
    for (const k of toRemove) this.docs.delete(k);
  }

  async getCurrentState(): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    for (const { sourceFile, commitHash } of this.docs.values()) {
      if (sourceFile && commitHash) m.set(sourceFile, commitHash);
    }
    return m;
  }

  async existingHashes(hashes: string[]): Promise<string[]> {
    return hashes.filter((h) => this.docs.has(h));
  }

  async deleteOrphanedChunks(
    sourceFile: string,
    keepHashes: string[],
  ): Promise<void> {
    const keep = new Set(keepHashes);
    const toRemove = [...this.docs.entries()]
      .filter(([k, v]) => v.sourceFile === sourceFile && !keep.has(k))
      .map(([k]) => k);
    for (const k of toRemove) this.docs.delete(k);
  }

  async search(): Promise<VectorSearchResult[]> {
    return [];
  }

  docCount(): number {
    return this.docs.size;
  }
}

describe("Orchestrator — two-run embedding cache", () => {
  let tmpDir: string;
  let originalCwd: string;
  let dbFile: string;
  let store: InMemoryStore;
  let embedCallCount: number;

  const mockEmbedder: EmbeddingProvider = {
    name: "mock-embedder",
    model: "mock-v1",
    dimensions: 384,
    async embed(_text: string): Promise<number[]> {
      embedCallCount++;
      return new Array(384).fill(0.1);
    },
  };

  const mockChunkerEntry: ChunkerEntry = {
    chunker: {
      name: "mock-chunker",
      version: "1.0.0",
      patterns: ["**/*.txt"],
      sparseTextGeneratorId: "mock-chunker@1.0.0:sparse:0000",
      metadataGeneratorId: "mock-chunker@1.0.0:meta:0000",
      async chunk(filePath: string, commitHash: string): Promise<Chunk[]> {
        return [
          {
            denseText: `content:${filePath}`,
            sparseText: `content:${filePath}`,
            denseTextHash: "",
            sparseTextGeneratorId: "mock-chunker@1.0.0:sparse:0000",
            metadataGeneratorId: "mock-chunker@1.0.0:meta:0000",
            metadata: {},
            sourceFile: filePath,
            commitHash,
          },
        ];
      },
    },
    fileSetTags: [],
    tagRules: [],
    chunkerKey: "@test/mock-chunker",
    fileSetName: "default",
  };

  beforeAll(() => {
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "virage-orch-cache-"));
    dbFile = join(tmpDir, "embeddings.db");

    execSync("git init", { cwd: tmpDir, stdio: "pipe" });
    execSync("git config user.email test@virage.test", {
      cwd: tmpDir,
      stdio: "pipe",
    });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "pipe" });

    writeFileSync(
      join(tmpDir, "hello.txt"),
      "Hello world content for testing.",
    );
    writeFileSync(join(tmpDir, "world.txt"), "World content for testing.");

    execSync("git add -A", { cwd: tmpDir, stdio: "pipe" });
    execSync('git commit -m "initial"', { cwd: tmpDir, stdio: "pipe" });

    // Change CWD so glob() in GitTracker finds the test files.
    // Safe here because vitest runs each test file in its own isolated worker.
    process.chdir(tmpDir);

    store = new InMemoryStore();
    embedCallCount = 0;
  });

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeConfig(): RAGPipelineConfig {
    return {
      fileSetEntries: [mockChunkerEntry],
      embedder: mockEmbedder,
      vectorStore: store,
      options: {
        embeddingsFile: dbFile,
        noBanner: true,
        minEmbeddingBatchSize: 1,
        minUploadingBatchSize: 1,
      },
    };
  }

  it("run 1 embeds all files; run 2 detects no changes and skips embedding", async () => {
    // --- Run 1: fresh state, both files should be embedded ---
    const orch1 = new Orchestrator(makeConfig());
    const result1 = await orch1.run();

    expect(result1.filesProcessed).toBe(2);
    expect(embedCallCount).toBe(2); // one embed() call per chunk (one chunk per file)
    expect(store.docCount()).toBe(2);

    const countAfterRun1 = embedCallCount;

    // --- Run 2: identical repo state — must be a true no-op ---
    const orch2 = new Orchestrator(makeConfig());
    const result2 = await orch2.run();

    expect(result2.filesProcessed).toBe(0);
    expect(result2.filesDeleted).toBe(0);
    expect(embedCallCount).toBe(countAfterRun1); // no new embed calls
    expect(store.docCount()).toBe(2); // store unchanged
  });

  it("chunk-level: unchanged chunks within a modified file are not re-embedded", async () => {
    // Use a fresh store and db — no state bleed from the first test
    const store2 = new InMemoryStore();
    const dbFile2 = join(tmpDir, "embeddings-layer2.db");
    let embedCount = 0;

    const lineEmbedder: EmbeddingProvider = {
      name: "mock-embedder",
      model: "mock-v1",
      dimensions: 384,
      async embed(_text: string): Promise<number[]> {
        embedCount++;
        return new Array(384).fill(0.1);
      },
    };

    // Chunker that splits file content by newlines — each line is its own chunk.
    const lineChunkerEntry: ChunkerEntry = {
      chunker: {
        name: "line-chunker",
        version: "1.0.0",
        patterns: ["**/*.txt"],
        sparseTextGeneratorId: "line-chunker@1.0.0:sparse:0000",
        metadataGeneratorId: "line-chunker@1.0.0:meta:0000",
        async chunk(filePath: string, commitHash: string): Promise<Chunk[]> {
          const lines = readFileSync(filePath, "utf8")
            .split("\n")
            .filter(Boolean);
          return lines.map((line) => ({
            denseText: line,
            sparseText: line,
            denseTextHash: "",
            sparseTextGeneratorId: "line-chunker@1.0.0:sparse:0000",
            metadataGeneratorId: "line-chunker@1.0.0:meta:0000",
            metadata: {},
            sourceFile: filePath,
            commitHash,
          }));
        },
      },
      fileSetTags: [],
      tagRules: [],
      chunkerKey: "@test/line-chunker",
      fileSetName: "default",
    };

    const makeConfig2 = (): RAGPipelineConfig => ({
      fileSetEntries: [lineChunkerEntry],
      embedder: lineEmbedder,
      vectorStore: store2,
      options: {
        embeddingsFile: dbFile2,
        noBanner: true,
        minEmbeddingBatchSize: 1,
        minUploadingBatchSize: 1,
      },
    });

    // Add a multi-chunk file: 2 lines → 2 chunks
    writeFileSync(join(tmpDir, "multi.txt"), "chunk-alpha\nchunk-beta");
    execSync("git add -A", { cwd: tmpDir, stdio: "pipe" });
    execSync('git commit -m "add multi.txt"', { cwd: tmpDir, stdio: "pipe" });

    // Run 1: hello.txt (1 line) + world.txt (1 line) + multi.txt (2 lines) = 4 chunks
    const result1 = await new Orchestrator(makeConfig2()).run();
    expect(result1.filesProcessed).toBe(3);
    expect(embedCount).toBe(4);

    // Modify multi.txt: keep chunk-alpha, replace chunk-beta with chunk-gamma
    writeFileSync(join(tmpDir, "multi.txt"), "chunk-alpha\nchunk-gamma");
    execSync("git add -A", { cwd: tmpDir, stdio: "pipe" });
    execSync('git commit -m "modify multi.txt"', {
      cwd: tmpDir,
      stdio: "pipe",
    });

    // Run 2: only multi.txt changed at the file level; within it, chunk-alpha is already
    // in the vector store (existingHashes returns it) → only chunk-gamma is embedded.
    const result2 = await new Orchestrator(makeConfig2()).run();
    expect(result2.filesProcessed).toBe(1); // only multi.txt changed
    expect(embedCount).toBe(5); // +1 only: chunk-gamma; chunk-alpha was cached
    // Store: hello(1) + world(1) + multi([alpha,gamma]) = 4; chunk-beta pruned by deleteOrphanedChunks
    expect(store2.docCount()).toBe(4);
  });
});
