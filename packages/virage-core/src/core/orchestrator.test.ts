import { describe, it, expect, vi } from "vitest";
import { Orchestrator, RAGPipelineConfig } from "./orchestrator.js";
import { defaultEmbeddingsDb } from "./virage-defaults.js";
import {
  FileChunker,
  EmbeddingProvider,
  VectorStore,
} from "../interfaces/index.js";

const mockChunker: FileChunker = {
  name: "test",
  patterns: ["**/*.txt"],
  chunk: vi.fn().mockResolvedValue([]),
};

const mockEmbedder: EmbeddingProvider = {
  name: "mock",
  dimensions: 384,
  embed: vi.fn().mockResolvedValue(new Array(384).fill(0)),
};

const mockVectorStore: VectorStore = {
  name: "mock",
  initialize: vi.fn().mockResolvedValue(undefined),
  upsert: vi.fn().mockResolvedValue(undefined),
  deleteBySourceFile: vi.fn().mockResolvedValue(undefined),
  getCurrentState: vi.fn().mockResolvedValue(new Map()),
  search: vi.fn().mockResolvedValue([]),
};

function makeConfig(
  overrides?: Partial<RAGPipelineConfig["options"]>,
): RAGPipelineConfig {
  return {
    chunkers: [mockChunker],
    embedder: mockEmbedder,
    vectorStore: mockVectorStore,
    options: {
      embeddingsFile: "./test-embeddings.db",
      force: false,
      skipUpload: true,
      ...overrides,
    },
  };
}

describe("Orchestrator", () => {
  it("should be instantiable", () => {
    const orchestrator = new Orchestrator(makeConfig());
    expect(orchestrator).toBeInstanceOf(Orchestrator);
  });

  it("run: completes without error when no matching files exist", async () => {
    const orchestrator = new Orchestrator(makeConfig());
    // No files match "**/*.txt" in the test environment's temp context
    // run() should log "No changes detected" and return cleanly
    await expect(orchestrator.run()).resolves.toBeUndefined();
  });

  it("run: uses force option from config", async () => {
    const config = makeConfig({ force: true });
    const orchestrator = new Orchestrator(config);
    // Even with force=true, if no files match, it either processes 0 files
    // or exits after chunk generation. Should not throw.
    await expect(orchestrator.run()).resolves.toBeUndefined();
  });

  it("should use custom embeddingsFile from options", () => {
    const config = makeConfig({ embeddingsFile: "./custom/embeddings.db" });
    const orchestrator = new Orchestrator(config);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((orchestrator as any).embeddingsFile).toBe("./custom/embeddings.db");
  });

  it("should fall back to default embeddingsDb when not specified", () => {
    const config: RAGPipelineConfig = {
      chunkers: [mockChunker],
      embedder: mockEmbedder,
      vectorStore: mockVectorStore,
    };
    const orchestrator = new Orchestrator(config);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((orchestrator as any).embeddingsFile).toBe(defaultEmbeddingsDb());
  });

  it("should use VIRAGE_DIR env var as default path prefix", () => {
    vi.stubEnv("VIRAGE_DIR", "/custom/dir");
    const config: RAGPipelineConfig = {
      chunkers: [mockChunker],
      embedder: mockEmbedder,
      vectorStore: mockVectorStore,
    };
    const orchestrator = new Orchestrator(config);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((orchestrator as any).embeddingsFile).toBe(
      "/custom/dir/embeddings.db",
    );
    vi.unstubAllEnvs();
  });
});
