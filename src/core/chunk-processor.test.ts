import { describe, it, expect, vi } from "vitest";
import { ChunkProcessor } from "./chunk-processor.js";
import { FileChunker } from "../interfaces/index.js";

describe("ChunkProcessor", () => {
  const mockChunker: FileChunker = {
    name: "test",
    patterns: ["**/*.txt"],
    chunk: vi.fn().mockResolvedValue([
      {
        content: "test content",
        metadata: { type: "test" },
        sourceFile: "test.txt",
        commitHash: "abc123",
        contentHash: "hash123",
      },
    ]),
  };

  it("should be instantiable", () => {
    const processor = new ChunkProcessor([mockChunker]);
    expect(processor).toBeInstanceOf(ChunkProcessor);
  });

  it("should have processFile method", () => {
    const processor = new ChunkProcessor([mockChunker]);
    expect(processor.processFile).toBeDefined();
    expect(typeof processor.processFile).toBe("function");
  });

  it("should have processFiles method", () => {
    const processor = new ChunkProcessor([mockChunker]);
    expect(processor.processFiles).toBeDefined();
    expect(typeof processor.processFiles).toBe("function");
  });
});
