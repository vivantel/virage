import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the native binding before importing the module under test.
// loadBinding() inside src-ts/index.ts calls createRequire(import.meta.url)
// and then require("./virage_embedder_onnx.node"). We replace node:module's
// createRequire so every require() inside the module returns our fake binding.
// ---------------------------------------------------------------------------
const mockEmbed = vi.fn();
const mockEmbedBatch = vi.fn();

// Must be a real constructor function (not an arrow) so `new OnnxEmbedder(...)`
// works in the TS wrapper.
const NativeEmbedderCtor = vi.fn(function (
  this: Record<string, unknown>,
) {
  this["embed"] = mockEmbed;
  this["embedBatch"] = mockEmbedBatch;
  this["dimensions"] = 384;
});

vi.mock("node:module", () => ({
  createRequire: () => () => ({ OnnxEmbedder: NativeEmbedderCtor }),
}));

// Import AFTER the vi.mock() hoisting takes effect.
const { OnnxEmbedder, createEmbedder } = await import("../src-ts/index.js");

// ---------------------------------------------------------------------------

describe("createEmbedder", () => {
  it("throws when model is missing", () => {
    expect(() => createEmbedder({ dimensions: 384 })).toThrow("config.model is required");
  });

  it("throws when dimensions is missing", () => {
    expect(() => createEmbedder({ model: "some/model" })).toThrow(
      "config.dimensions is required",
    );
  });

  it("throws when dimensions is zero", () => {
    expect(() => createEmbedder({ model: "some/model", dimensions: 0 })).toThrow(
      "config.dimensions is required",
    );
  });

  it("returns an OnnxEmbedder with correct properties", () => {
    const e = createEmbedder({ model: "sentence-transformers/all-MiniLM-L6-v2", dimensions: 384 });
    expect(e.dimensions).toBe(384);
    expect(e.preferredBatchSize).toBe(32);
  });
});

describe("OnnxEmbedder", () => {
  describe("properties", () => {
    it("sets name from model id", () => {
      const e = new OnnxEmbedder({ model: "org/my-model", dimensions: 768 });
      expect(e.name).toContain("onnx:");
      expect(e.name).toContain("org");
      expect(e.name).toContain("my-model");
    });

    it("exposes dimensions and preferredBatchSize", () => {
      const e = new OnnxEmbedder({ model: "org/m", dimensions: 512 });
      expect(e.dimensions).toBe(512);
      expect(e.preferredBatchSize).toBe(32);
    });
  });

  describe("embed()", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      NativeEmbedderCtor.mockClear();
    });

    it("returns number[] from native Float32Array", async () => {
      mockEmbed.mockReturnValue(new Float32Array([0.1, 0.2, 0.3]));
      const e = new OnnxEmbedder({ model: "/local/model", dimensions: 3 });
      const result = await e.embed("hello world");

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);
      expect(result[0]).toBeCloseTo(0.1);
      expect(result[1]).toBeCloseTo(0.2);
      expect(result[2]).toBeCloseTo(0.3);
    });

    it("passes text to native embed", async () => {
      mockEmbed.mockReturnValue(new Float32Array([1, 0]));
      const e = new OnnxEmbedder({ model: "/local/model", dimensions: 2 });
      await e.embed("test input");
      expect(mockEmbed).toHaveBeenCalledWith("test input");
    });
  });

  describe("embedBatch()", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      NativeEmbedderCtor.mockClear();
    });

    it("reshapes flat Float32Array into number[][]", async () => {
      // dim=2, batch=3 → flat=[1,2, 3,4, 5,6]
      mockEmbedBatch.mockReturnValue(new Float32Array([1, 2, 3, 4, 5, 6]));
      const e = new OnnxEmbedder({ model: "/local/model", dimensions: 2 });
      const result = await e.embedBatch(["a", "b", "c"]);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual([1, 2]);
      expect(result[1]).toEqual([3, 4]);
      expect(result[2]).toEqual([5, 6]);
    });

    it("returns empty array for empty input", async () => {
      mockEmbedBatch.mockReturnValue(new Float32Array([]));
      const e = new OnnxEmbedder({ model: "/local/model", dimensions: 4 });
      const result = await e.embedBatch([]);
      expect(result).toEqual([]);
    });

    it("passes texts array to native embedBatch", async () => {
      const texts = ["foo", "bar"];
      mockEmbedBatch.mockReturnValue(new Float32Array([0, 1, 0, 1]));
      const e = new OnnxEmbedder({ model: "/local/model", dimensions: 2 });
      await e.embedBatch(texts);
      expect(mockEmbedBatch).toHaveBeenCalledWith(texts);
    });
  });

  describe("preWarm()", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      NativeEmbedderCtor.mockClear();
    });

    it("constructs native embedder exactly once for repeated calls", async () => {
      mockEmbed.mockReturnValue(new Float32Array([1, 0]));
      const e = new OnnxEmbedder({ model: "/local/model", dimensions: 2 });
      await e.preWarm();
      await e.preWarm();
      await e.embed("x");
      expect(NativeEmbedderCtor).toHaveBeenCalledTimes(1);
    });
  });
});
