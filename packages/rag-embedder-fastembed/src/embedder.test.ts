import { describe, it, expect, vi, beforeEach } from "vitest";
import { FastEmbedEmbedder } from "./embedder.js";
import { createEmbedder } from "./index.js";

async function* mockEmbedGen(vectors: number[][]): AsyncGenerator<number[][]> {
  yield vectors;
}

const mockEmbed = vi.fn();

vi.mock("fastembed", () => {
  class MockEmbeddingModel {
    embed = mockEmbed;
  }
  return { EmbeddingModel: MockEmbeddingModel };
});

describe("FastEmbedEmbedder", () => {
  beforeEach(() => {
    mockEmbed.mockReset();
    mockEmbed.mockReturnValue(mockEmbedGen([[0.1, 0.2, 0.3]]));
  });

  it("exposes name, model, and dimensions", () => {
    const embedder = new FastEmbedEmbedder({
      model: "BAAI/bge-small-en-v1.5",
      dimensions: 384,
    });
    expect(embedder.name).toBe("fastembed");
    expect(embedder.model).toBe("BAAI/bge-small-en-v1.5");
    expect(embedder.dimensions).toBe(384);
  });

  it("uses default model and dimensions when omitted", () => {
    const embedder = new FastEmbedEmbedder();
    expect(embedder.model).toBe("BAAI/bge-small-en-v1.5");
    expect(embedder.dimensions).toBe(384);
  });

  it("embed() returns a single vector", async () => {
    mockEmbed.mockReturnValueOnce(mockEmbedGen([[0.1, 0.2, 0.3]]));
    const embedder = new FastEmbedEmbedder({ model: "test", dimensions: 3 });
    const result = await embedder.embed("hello");
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("embedBatch() returns one vector per text", async () => {
    mockEmbed.mockReturnValueOnce(
      mockEmbedGen([
        [1, 0, 0],
        [0, 1, 0],
      ]),
    );
    const embedder = new FastEmbedEmbedder({ model: "test", dimensions: 3 });
    const result = await embedder.embedBatch(["a", "b"]);
    expect(result).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it("initializes the model lazily (only on first embed call)", async () => {
    mockEmbed.mockReturnValue(mockEmbedGen([[0.1]]));
    const embedder = new FastEmbedEmbedder({
      model: "BAAI/bge-small-en-v1.5",
      dimensions: 1,
    });
    // Not called yet
    expect(mockEmbed).toHaveBeenCalledTimes(0);
    await embedder.embed("hello");
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    // Second call reuses the same inner model (mockEmbed still at 2, not a new instance)
    await embedder.embed("world");
    expect(mockEmbed).toHaveBeenCalledTimes(2);
  });

  it("healthCheck() returns true when model loads", async () => {
    const embedder = new FastEmbedEmbedder({ model: "test", dimensions: 3 });
    expect(await embedder.healthCheck()).toBe(true);
  });

  it("healthCheck() returns false when model fails to load", async () => {
    const fastembed = await import("fastembed");
    const origClass = fastembed.EmbeddingModel;
    // Override temporarily to throw
    vi.spyOn(fastembed, "EmbeddingModel" as never).mockImplementationOnce(
      () => {
        throw new Error("Download failed");
      },
    );

    const embedder = new FastEmbedEmbedder({
      model: "bad-model",
      dimensions: 3,
    });
    expect(await embedder.healthCheck()).toBe(false);

    vi.spyOn(fastembed, "EmbeddingModel" as never).mockRestore();
    void origClass;
  });
});

describe("createEmbedder factory", () => {
  it("uses defaults when config is empty", () => {
    const embedder = createEmbedder({});
    expect(embedder.model).toBe("BAAI/bge-small-en-v1.5");
  });

  it("respects provided model and dimensions", () => {
    const embedder = createEmbedder({
      model: "BAAI/bge-base-en-v1.5",
      dimensions: 768,
    });
    expect(embedder.model).toBe("BAAI/bge-base-en-v1.5");
    expect(embedder.dimensions).toBe(768);
  });
});
