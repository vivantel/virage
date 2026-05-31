import { describe, it, expect, vi } from "vitest";
import { Orchestrator, RAGPipelineConfig } from "./orchestrator.js";
import {
  FileChunker,
  EmbeddingProvider,
  VectorStore,
} from "../interfaces/index.js";

describe("Orchestrator", () => {
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

  const mockConfig: RAGPipelineConfig = {
    chunkers: [mockChunker],
    embedder: mockEmbedder,
    vectorStore: mockVectorStore,
    options: {
      chunksFile: "./test-chunks.json",
      embeddingsFile: "./test-embeddings.json",
      force: false,
      skipUpload: true,
    },
  };

  it("should be instantiable", () => {
    const orchestrator = new Orchestrator(mockConfig);
    expect(orchestrator).toBeInstanceOf(Orchestrator);
  });

  it("should have run method", () => {
    const orchestrator = new Orchestrator(mockConfig);
    expect(orchestrator.run).toBeDefined();
    expect(typeof orchestrator.run).toBe("function");
  });
});
