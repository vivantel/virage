import { describe, it, expect, vi } from "vitest";
import { ChunkProcessor } from "./chunk-processor.js";
import { ChunkerEntry, FileChunker, Chunk } from "../interfaces/index.js";

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

const mockEntry: ChunkerEntry = {
  chunker: mockChunker,
  fileSetTags: [],
  tagRules: [],
  chunkerKey: "@test/chunker",
  fileSetName: "default",
};

describe("ChunkProcessor", () => {
  it("should be instantiable", () => {
    const processor = new ChunkProcessor();
    expect(processor).toBeInstanceOf(ChunkProcessor);
  });

  it("processEntries: populates denseTextHash, sourceFile, and commitHash on returned chunks", async () => {
    const processor = new ChunkProcessor();
    const chunks = await processor.processEntries("file.txt", "hash123", [
      mockEntry,
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].denseTextHash).toBeDefined();
    expect(typeof chunks[0].denseTextHash).toBe("string");
    expect(chunks[0].denseTextHash!.length).toBe(16);
    expect(chunks[0].sourceFile).toBe("file.txt");
    expect(chunks[0].commitHash).toBe("hash123");
  });

  it("processEntries: returns empty array when chunker returns no chunks", async () => {
    const emptyChunker: FileChunker = {
      name: "empty",
      version: "1.0.0",
      patterns: ["**/*.txt"],
      sparseTextGeneratorId: "empty@1.0.0:sparse:default",
      metadataGeneratorId: "empty@1.0.0:meta:default",
      chunk: vi.fn().mockResolvedValue([]),
    };
    const emptyEntry: ChunkerEntry = {
      chunker: emptyChunker,
      fileSetTags: [],
      tagRules: [],
      chunkerKey: "@test/empty",
      fileSetName: "default",
    };
    const processor = new ChunkProcessor();
    const chunks = await processor.processEntries("file.txt", "hash123", [
      emptyEntry,
    ]);
    expect(chunks).toHaveLength(0);
  });

  it("processEntries: logs error and continues when chunker throws", async () => {
    const failingChunker: FileChunker = {
      name: "fail",
      version: "1.0.0",
      patterns: ["**/*.txt"],
      sparseTextGeneratorId: "fail@1.0.0:sparse:default",
      metadataGeneratorId: "fail@1.0.0:meta:default",
      chunk: vi.fn().mockRejectedValue(new Error("chunker failed")),
    };
    const failEntry: ChunkerEntry = {
      chunker: failingChunker,
      fileSetTags: [],
      tagRules: [],
      chunkerKey: "@test/fail",
      fileSetName: "default",
    };
    const processor = new ChunkProcessor();
    // Multi-chunker: error is logged, not re-thrown
    const chunks = await processor.processEntries("file.txt", "hash123", [
      failEntry,
    ]);
    expect(chunks).toHaveLength(0);
  });

  it("processFiles: aggregates chunks across multiple files", async () => {
    const processor = new ChunkProcessor();
    const fileState = new Map([
      ["a.txt", { commitHash: "hash-a", entries: [mockEntry] }],
      ["b.txt", { commitHash: "hash-b", entries: [mockEntry] }],
    ]);
    const chunks = await processor.processFiles(["a.txt", "b.txt"], fileState);
    expect(chunks).toHaveLength(2);
  });

  it("processFiles: skips files with no entry in fileState", async () => {
    const processor = new ChunkProcessor();
    const fileState = new Map<
      string,
      { commitHash: string; entries: ChunkerEntry[] }
    >();
    const chunks = await processor.processFiles(["a.txt"], fileState);
    expect(chunks).toHaveLength(0);
  });

  it("processFiles: continues processing remaining files when one chunker throws", async () => {
    const failingChunker: FileChunker = {
      name: "fail",
      version: "1.0.0",
      patterns: ["**/*.txt"],
      sparseTextGeneratorId: "fail@1.0.0:sparse:default",
      metadataGeneratorId: "fail@1.0.0:meta:default",
      chunk: vi.fn().mockRejectedValue(new Error("chunker failed")),
    };
    const failEntry: ChunkerEntry = {
      chunker: failingChunker,
      fileSetTags: [],
      tagRules: [],
      chunkerKey: "@test/fail",
      fileSetName: "default",
    };
    const processor = new ChunkProcessor();
    const fileState = new Map([
      ["bad.txt", { commitHash: "h1", entries: [failEntry] }],
      ["good.txt", { commitHash: "h2", entries: [mockEntry] }],
    ]);
    const chunks = await processor.processFiles(
      ["bad.txt", "good.txt"],
      fileState,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sourceFile).toBe("good.txt");
  });
});
