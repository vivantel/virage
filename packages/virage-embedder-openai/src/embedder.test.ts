import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAICompatibleEmbedder } from "./embedder.js";
import { createEmbedder } from "./index.js";
import { createOllamaEmbedder, createAzureOpenAIEmbedder } from "./presets.js";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  class MockOpenAI {
    embeddings = { create: mockCreate };
    constructor() {}
  }
  return { default: MockOpenAI };
});

describe("OpenAICompatibleEmbedder", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
  });

  it("exposes name, model, and dimensions", () => {
    const embedder = new OpenAICompatibleEmbedder({
      apiKey: "test-key",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
    expect(embedder.model).toBe("text-embedding-3-small");
    expect(embedder.dimensions).toBe(1536);
    expect(embedder.name).toBe("openai");
  });

  it("includes hostname in name for non-default baseURL", () => {
    const embedder = new OpenAICompatibleEmbedder({
      apiKey: "test-key",
      model: "openai/text-embedding-3-small",
      baseURL: "https://models.github.ai/inference",
    });
    expect(embedder.name).toBe("openai-compatible:models.github.ai");
  });

  it("embed() calls the API and returns a single vector", async () => {
    mockCreate.mockResolvedValueOnce({ data: [{ embedding: [1, 2, 3] }] });
    const embedder = new OpenAICompatibleEmbedder({
      apiKey: "k",
      model: "m",
      dimensions: 3,
    });
    const result = await embedder.embed("hello");
    expect(result).toEqual([1, 2, 3]);
  });

  it("embedBatch() calls the API with all texts and returns all vectors", async () => {
    mockCreate.mockResolvedValueOnce({
      data: [{ embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }],
    });
    const embedder = new OpenAICompatibleEmbedder({
      apiKey: "k",
      model: "m",
      dimensions: 3,
    });
    const result = await embedder.embedBatch(["a", "b"]);
    expect(result).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ input: ["a", "b"] }),
    );
  });

  it("healthCheck() returns true on success and false on error", async () => {
    const embedder = new OpenAICompatibleEmbedder({
      apiKey: "k",
      model: "m",
      dimensions: 3,
    });
    mockCreate.mockResolvedValueOnce({ data: [{ embedding: [1, 2, 3] }] });
    expect(await embedder.healthCheck()).toBe(true);

    mockCreate.mockRejectedValueOnce(new Error("Unauthorized"));
    expect(await embedder.healthCheck()).toBe(false);
  });
});

describe("createEmbedder factory", () => {
  it("throws if apiKey is missing", () => {
    expect(() => createEmbedder({ model: "text-embedding-3-small" })).toThrow(
      "apiKey",
    );
  });

  it("throws if model is missing", () => {
    expect(() => createEmbedder({ apiKey: "k" })).toThrow("model");
  });

  it("returns an OpenAICompatibleEmbedder with correct model", () => {
    const embedder = createEmbedder({
      apiKey: "k",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
    expect(embedder.model).toBe("text-embedding-3-small");
    expect(embedder.dimensions).toBe(1536);
  });
});

describe("presets", () => {
  it("createOllamaEmbedder uses ollama baseURL", () => {
    const embedder = createOllamaEmbedder({
      model: "nomic-embed-text",
      dimensions: 768,
    });
    expect(embedder.name).toContain("localhost");
    expect(embedder.dimensions).toBe(768);
  });

  it("createAzureOpenAIEmbedder uses provided endpoint", () => {
    const embedder = createAzureOpenAIEmbedder({
      apiKey: "k",
      endpoint: "https://my-resource.openai.azure.com",
    });
    expect(embedder.name).toContain("my-resource.openai.azure.com");
  });
});
