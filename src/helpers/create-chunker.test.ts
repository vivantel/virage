import { describe, it, expect, vi } from "vitest";
import { createChunker } from "./create-chunker.js";

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
});
