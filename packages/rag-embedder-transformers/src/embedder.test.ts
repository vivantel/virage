import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransformersEmbedder } from "./embedder.js";
import { createEmbedder } from "./index.js";

const mockPipeline = vi.fn();
const mockPipelineOutput = {
  data: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.1, 0.2, 0.3, 0.4]),
};

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn().mockResolvedValue(mockPipeline),
  env: { cacheDir: "" },
}));

describe("TransformersEmbedder", () => {
  beforeEach(() => {
    mockPipeline.mockReset();
    mockPipeline.mockResolvedValue(mockPipelineOutput);
  });

  it("exposes name, model, and dimensions", () => {
    const embedder = new TransformersEmbedder({
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: 384,
    });
    expect(embedder.name).toBe("transformers");
    expect(embedder.model).toBe("Xenova/all-MiniLM-L6-v2");
    expect(embedder.dimensions).toBe(384);
  });

  it("embed() initializes pipeline lazily and returns a vector", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    (pipeline as ReturnType<typeof vi.fn>).mockClear();

    mockPipeline.mockResolvedValueOnce({ data: new Float32Array([0.1, 0.2, 0.3]) });

    const embedder = new TransformersEmbedder({ model: "test-model", dimensions: 3 });
    const result = await embedder.embed("hello");

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    // Pipeline is created on demand
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("embed() reuses the same pipeline instance (lazy init)", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    (pipeline as ReturnType<typeof vi.fn>).mockClear();

    mockPipeline.mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]) });

    const embedder = new TransformersEmbedder({ model: "test-model", dimensions: 3 });
    await embedder.embed("a");
    await embedder.embed("b");

    // pipeline() should only be called once
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("embedBatch() returns one vector per input text", async () => {
    // 2 texts × 4 dims = 8 floats in the output
    mockPipeline.mockResolvedValueOnce({
      data: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
    });
    const embedder = new TransformersEmbedder({ model: "m", dimensions: 4 });
    const result = await embedder.embedBatch(["a", "b"]);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(4);
    expect(result[1]).toHaveLength(4);
  });

  it("healthCheck() returns true when pipeline loads successfully", async () => {
    const embedder = new TransformersEmbedder({ model: "test", dimensions: 3 });
    expect(await embedder.healthCheck()).toBe(true);
  });

  it("healthCheck() returns false when pipeline fails to load", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    (pipeline as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Model not found"),
    );

    const embedder = new TransformersEmbedder({ model: "bad-model", dimensions: 3 });
    expect(await embedder.healthCheck()).toBe(false);
  });
});

describe("createEmbedder factory", () => {
  it("throws if model is missing", () => {
    expect(() => createEmbedder({})).toThrow("model");
  });

  it("returns a TransformersEmbedder with the correct model", () => {
    const embedder = createEmbedder({
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: 384,
    });
    expect(embedder.model).toBe("Xenova/all-MiniLM-L6-v2");
    expect(embedder.dimensions).toBe(384);
  });
});
