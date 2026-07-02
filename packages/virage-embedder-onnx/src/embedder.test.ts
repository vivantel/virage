import { describe, it, expect, vi, beforeEach } from "vitest";
import { OnnxEmbedder } from "./embedder.js";
import { createEmbedder } from "./index.js";

// Mock onnxruntime-node
const mockRun = vi.fn();
const mockCreate = vi.fn();
vi.mock("onnxruntime-node", () => ({
  InferenceSession: { create: mockCreate },
  Tensor: class MockTensor {
    constructor(
      public readonly type: string,
      public readonly data: unknown,
      public readonly dims: number[],
    ) {}
  },
}));

// Mock tokenizers
const mockEncode = vi.fn();
vi.mock("tokenizers", () => ({
  AutoTokenizer: {
    fromFile: vi.fn(async () => ({
      encode: mockEncode,
    })),
  },
}));

// Stub tokenizer encode to return consistent mock IDs/mask
function makeEncodeResult(ids: number[]) {
  return {
    getIds: () => new Uint32Array(ids),
    getAttentionMask: () => new Uint32Array(ids.map(() => 1)),
    getTypeIds: () => new Uint32Array(ids.map(() => 0)),
  };
}

describe("OnnxEmbedder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEncode.mockImplementation(() => makeEncodeResult([1, 2, 3]));
    // Return mock last_hidden_state: [batchSize, seqLen, dims]
    mockRun.mockResolvedValue({
      last_hidden_state: { data: new Float32Array(3 * 3 * 4).fill(0.5) },
    });
    mockCreate.mockResolvedValue({ run: mockRun });
  });

  it("exposes name, dimensions, and model", () => {
    const embedder = new OnnxEmbedder({
      model: "/models/bge",
      dimensions: 384,
    });
    expect(embedder.dimensions).toBe(384);
    expect(embedder.model).toBe("/models/bge");
    expect(embedder.name).toContain("onnx");
  });

  it("preWarm() loads the ONNX session and tokenizer", async () => {
    const embedder = new OnnxEmbedder({
      model: "/local/model",
      dimensions: 4,
    });
    await embedder.preWarm();
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("preWarm() is idempotent — session loaded only once", async () => {
    const embedder = new OnnxEmbedder({ model: "/local/model", dimensions: 4 });
    await embedder.preWarm();
    await embedder.preWarm();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("embed() returns a vector of the correct length", async () => {
    const dims = 4;
    mockRun.mockResolvedValue({
      last_hidden_state: {
        data: new Float32Array(1 * 3 * dims).fill(0.5),
      },
    });
    const embedder = new OnnxEmbedder({
      model: "/local/model",
      dimensions: dims,
    });
    await embedder.preWarm();
    const vec = await embedder.embed("hello world");
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBe(dims);
  });

  it("embedBatch() returns a vector per input text", async () => {
    const dims = 4;
    const batchSize = 2;
    const seqLen = 3;
    mockRun.mockResolvedValue({
      last_hidden_state: {
        data: new Float32Array(batchSize * seqLen * dims).fill(0.25),
      },
    });
    const embedder = new OnnxEmbedder({
      model: "/local/model",
      dimensions: dims,
    });
    await embedder.preWarm();
    const vecs = await embedder.embedBatch(["text one", "text two"]);
    expect(vecs.length).toBe(batchSize);
    for (const v of vecs) {
      expect(v.length).toBe(dims);
    }
  });

  it("normalize=true produces a unit-length vector (default)", async () => {
    const dims = 4;
    const flat = new Float32Array(1 * 3 * dims);
    // Set non-trivial values
    flat[0] = 1;
    flat[4] = 2;
    flat[8] = 3;
    mockRun.mockResolvedValue({
      last_hidden_state: { data: flat },
    });
    const embedder = new OnnxEmbedder({
      model: "/local/model",
      dimensions: dims,
      normalize: true,
    });
    await embedder.preWarm();
    const vec = await embedder.embed("text");
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it("normalize=false does not normalize the vector", async () => {
    const dims = 4;
    const flat = new Float32Array(1 * 3 * dims).fill(2.0);
    mockRun.mockResolvedValue({
      last_hidden_state: { data: flat },
    });
    const embedder = new OnnxEmbedder({
      model: "/local/model",
      dimensions: dims,
      normalize: false,
    });
    await embedder.preWarm();
    const vec = await embedder.embed("text");
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeGreaterThan(1.0);
  });
});

describe("createEmbedder", () => {
  it("throws when model is missing", () => {
    expect(() => createEmbedder({ dimensions: 384 })).toThrow("model");
  });

  it("throws when dimensions is missing", () => {
    expect(() => createEmbedder({ model: "mymodel" })).toThrow("dimensions");
  });

  it("returns an OnnxEmbedder with correct properties", () => {
    const e = createEmbedder({ model: "/local/m", dimensions: 768 });
    expect(e).toBeInstanceOf(OnnxEmbedder);
    expect(e.dimensions).toBe(768);
  });
});
