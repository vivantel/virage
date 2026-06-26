import { describe, it, expect, vi } from "vitest";
import { ChunkProcessor } from "./chunk-processor.js";
import { FileChunker, Chunk } from "../interfaces/index.js";

const baseChunk: Chunk = {
  denseText: "test content",
  sparseText: "test content",
  denseTextHash: "abcd1234abcd1234",
  sparseTextGeneratorId: "test@1.0.0:sparse:default",
  metadataGeneratorId: "test@1.0.0:meta:default",
  metadata: { type: "test" },
  sourceFile: "test.txt",
  commitHash: "abc123",
};

const mockChunker: FileChunker = {
  name: "test",
  version: "1.0.0",
  patterns: ["**/*.txt"],
  sparseTextGeneratorId: "test@1.0.0:sparse:default",
  metadataGeneratorId: "test@1.0.0:meta:default",
  chunk: vi.fn().mockResolvedValue([baseChunk]),
};

describe("ChunkProcessor", () => {
  it("should be instantiable", () => {
    const processor = new ChunkProcessor([mockChunker]);
    expect(processor).toBeInstanceOf(ChunkProcessor);
  });

  it("processFile: populates denseTextHash, sourceFile, and commitHash on returned chunks", async () => {
    const processor = new ChunkProcessor([mockChunker]);
    const chunks = await processor.processFile(
      "file.txt",
      "hash123",
      mockChunker,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].denseTextHash).toBeDefined();
    expect(typeof chunks[0].denseTextHash).toBe("string");
    expect(chunks[0].denseTextHash!.length).toBe(16);
    expect(chunks[0].sourceFile).toBe("file.txt");
    expect(chunks[0].commitHash).toBe("hash123");
  });

  it("processFile: returns empty array when chunker returns no chunks", async () => {
    const emptyChunker: FileChunker = {
      name: "empty",
      version: "1.0.0",
      patterns: ["**/*.txt"],
      sparseTextGeneratorId: "empty@1.0.0:sparse:default",
      metadataGeneratorId: "empty@1.0.0:meta:default",
      chunk: vi.fn().mockResolvedValue([]),
    };
    const processor = new ChunkProcessor([emptyChunker]);
    const chunks = await processor.processFile(
      "file.txt",
      "hash123",
      emptyChunker,
    );
    expect(chunks).toHaveLength(0);
  });

  it("processFile: propagates errors from chunker", async () => {
    const failingChunker: FileChunker = {
      name: "fail",
      version: "1.0.0",
      patterns: ["**/*.txt"],
      sparseTextGeneratorId: "fail@1.0.0:sparse:default",
      metadataGeneratorId: "fail@1.0.0:meta:default",
      chunk: vi.fn().mockRejectedValue(new Error("chunker failed")),
    };
    const processor = new ChunkProcessor([failingChunker]);
    await expect(
      processor.processFile("file.txt", "hash123", failingChunker),
    ).rejects.toThrow("chunker failed");
  });

  it("processFiles: aggregates chunks across multiple files", async () => {
    const processor = new ChunkProcessor([mockChunker]);
    const fileState = new Map([
      ["a.txt", { commitHash: "hash-a", chunker: mockChunker }],
      ["b.txt", { commitHash: "hash-b", chunker: mockChunker }],
    ]);
    const chunks = await processor.processFiles(["a.txt", "b.txt"], fileState);
    expect(chunks).toHaveLength(2);
  });

  it("processFiles: skips files with no entry in fileState", async () => {
    const processor = new ChunkProcessor([mockChunker]);
    const fileState = new Map<
      string,
      { commitHash: string; chunker: FileChunker }
    >();
    const chunks = await processor.processFiles(["a.txt"], fileState);
    expect(chunks).toHaveLength(0);
  });

  it("processFiles: continues processing remaining files when one throws", async () => {
    const failingChunker: FileChunker = {
      name: "fail",
      version: "1.0.0",
      patterns: ["**/*.txt"],
      sparseTextGeneratorId: "fail@1.0.0:sparse:default",
      metadataGeneratorId: "fail@1.0.0:meta:default",
      chunk: vi.fn().mockRejectedValue(new Error("chunker failed")),
    };
    const processor = new ChunkProcessor([mockChunker, failingChunker]);
    const fileState = new Map([
      ["bad.txt", { commitHash: "h1", chunker: failingChunker }],
      ["good.txt", { commitHash: "h2", chunker: mockChunker }],
    ]);
    const chunks = await processor.processFiles(
      ["bad.txt", "good.txt"],
      fileState,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sourceFile).toBe("good.txt");
  });
});
