import { describe, it, expect, vi } from "vitest";
import { createChunker } from "./create-chunker.js";
import type { ChunkStrategy, Chunk } from "../interfaces/index.js";

describe("createChunker", () => {
  it("should create a chunker with given options", () => {
    const mockProcess = vi.fn().mockResolvedValue([]);

    const chunker = createChunker({
      name: "test-chunker",
      patterns: ["**/*.txt"],
      process: mockProcess,
    });

    expect(chunker.name).toBe("test-chunker");
    expect(chunker.patterns).toEqual(["**/*.txt"]);
    expect(chunker.chunk).toBeDefined();
  });

  it("should have canProcess method when provided", () => {
    const mockCanProcess = vi.fn().mockResolvedValue(true);

    const chunker = createChunker({
      name: "test",
      patterns: ["**/*.txt"],
      process: vi.fn().mockResolvedValue([]),
      canProcess: mockCanProcess,
    });

    expect(chunker.canProcess).toBeDefined();
  });

  describe("strategy shorthand", () => {
    function makeStrategy(name: string): ChunkStrategy {
      return {
        name,
        chunk: vi
          .fn()
          .mockResolvedValue([
            { content: "c", metadata: {}, sourceFile: "f", commitHash: "h" },
          ] as Chunk[]),
      };
    }

    it("auto-derives name from strategy.name and first pattern", () => {
      const strategy = makeStrategy("token");
      const chunker = createChunker({ patterns: ["src/**/*.ts"], strategy });
      expect(chunker.name).toBe("token:src/**/*.ts");
    });

    it("explicit name overrides auto-derive", () => {
      const strategy = makeStrategy("token");
      const chunker = createChunker({
        name: "my-chunker",
        patterns: ["src/**/*.ts"],
        strategy,
      });
      expect(chunker.name).toBe("my-chunker");
    });

    it("delegates chunk() to strategy.chunk with (content, filePath)", async () => {
      const strategy = makeStrategy("markdown");
      const chunker = createChunker({ patterns: ["**/*.md"], strategy });

      // Mock fs/promises readFile for the chunk() call
      vi.doMock("fs/promises", () => ({
        readFile: vi.fn().mockResolvedValue("# Hello"),
      }));

      // strategy.chunk is a mock — verify it is called correctly
      // We test this by calling chunk() after mocking readFile via the strategy spy
      await chunker.chunk("docs/foo.md", "abc123");

      expect(strategy.chunk).toHaveBeenCalledWith("# Hello", "docs/foo.md");
    });

    it("passes patterns through", () => {
      const strategy = makeStrategy("whole-file");
      const chunker = createChunker({
        patterns: ["**/*.yaml", "**/*.yml"],
        strategy,
      });
      expect(chunker.patterns).toEqual(["**/*.yaml", "**/*.yml"]);
    });
  });
});
