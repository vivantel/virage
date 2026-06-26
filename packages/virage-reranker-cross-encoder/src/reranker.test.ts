import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VectorSearchResult } from "@vivantel/virage-core";
import { CrossEncoderReranker } from "./reranker.js";
import { createReranker } from "./index.js";

const mockTokenize = vi.fn().mockReturnValue({});
const mockModelCall = vi.fn();
const mockFromPretrainedTokenizer = vi.fn().mockResolvedValue(mockTokenize);
const mockFromPretrainedModel = vi.fn().mockResolvedValue(mockModelCall);

vi.mock("@huggingface/transformers", () => ({
  AutoTokenizer: { from_pretrained: mockFromPretrainedTokenizer },
  AutoModelForSequenceClassification: {
    from_pretrained: mockFromPretrainedModel,
  },
}));

function makeCandidate(
  id: string,
  denseText: string,
  similarity = 0.5,
): VectorSearchResult {
  return {
    id,
    denseText,
    sparseText: "",
    similarity,
    metadata: {},
  };
}

describe("CrossEncoderReranker", () => {
  beforeEach(() => {
    mockModelCall.mockReset();
    mockFromPretrainedTokenizer.mockClear();
    mockFromPretrainedModel.mockClear();
    mockTokenize.mockClear();
  });

  it("returns empty array immediately when no candidates given", async () => {
    const reranker = new CrossEncoderReranker();
    const result = await reranker.rerank("some query", []);
    expect(result).toEqual([]);
    expect(mockModelCall).not.toHaveBeenCalled();
  });

  it("tokenizes all candidates as a batched query/document pair", async () => {
    const reranker = new CrossEncoderReranker();
    mockModelCall.mockResolvedValue({ logits: { data: [5.2] } });

    await reranker.rerank("my query", [makeCandidate("a", "some text")]);
    expect(mockTokenize).toHaveBeenCalledWith(["my query"], {
      text_pair: ["some text"],
      padding: true,
      truncation: true,
    });
  });

  it("reorders candidates by raw logit descending", async () => {
    const reranker = new CrossEncoderReranker();
    const candidates = [
      makeCandidate("a", "low relevance", 0.8),
      makeCandidate("b", "high relevance", 0.3),
      makeCandidate("c", "medium relevance", 0.5),
    ];
    // Single batched call returns all logits in candidate order
    mockModelCall.mockResolvedValueOnce({
      logits: { data: [-3.0, 8.5, 2.1] }, // a: not relevant, b: highly relevant, c: somewhat
    });

    const result = await reranker.rerank("query", candidates);
    expect(result.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("calibrates scores via sigmoid so higher logit → higher similarity", async () => {
    const reranker = new CrossEncoderReranker();
    const candidates = [
      makeCandidate("a", "low", 0.8),
      makeCandidate("b", "high", 0.3),
      makeCandidate("c", "mid", 0.5),
    ];
    // Single batched call: logits in candidate order [a, b, c]
    mockModelCall.mockResolvedValueOnce({
      logits: { data: [0.1, 0.9, 0.5] }, // a≈0.525, b≈0.711, c≈0.622
    });

    const result = await reranker.rerank("query", candidates);
    // Order: b > c > a
    expect(result[0].id).toBe("b");
    expect(result[1].id).toBe("c");
    expect(result[2].id).toBe("a");
    // Scores are sigmoid-calibrated, not min-max normalized
    expect(result[0].similarity).toBeCloseTo(1 / (1 + Math.exp(-0.9)), 5);
    expect(result[1].similarity).toBeCloseTo(1 / (1 + Math.exp(-0.5)), 5);
    expect(result[2].similarity).toBeCloseTo(1 / (1 + Math.exp(-0.1)), 5);
  });

  it("single result gets sigmoid-calibrated similarity (not forced to 1)", async () => {
    const reranker = new CrossEncoderReranker();
    const candidates = [makeCandidate("x", "some content", 0.5)];
    mockModelCall.mockResolvedValue({ logits: { data: [7.3] } });

    const result = await reranker.rerank("query", candidates);
    // sigmoid(7.3) ≈ 0.9993 — very high but not exactly 1
    expect(result[0].similarity).toBeCloseTo(1 / (1 + Math.exp(-7.3)), 5);
    expect(result[0].similarity).toBeGreaterThan(0.99);
  });

  it("assigns near-zero similarity to highly negative logit", async () => {
    const reranker = new CrossEncoderReranker();
    const candidates = [makeCandidate("x", "irrelevant content", 0.5)];
    mockModelCall.mockResolvedValue({ logits: { data: [-8] } });

    const result = await reranker.rerank("query", candidates);
    // sigmoid(-8) ≈ 0.000335 — clearly not relevant
    expect(result[0].similarity).toBeLessThan(0.01);
  });

  it("filters results below minScore threshold", async () => {
    const reranker = new CrossEncoderReranker({ minScore: 0.5 });
    const candidates = [
      makeCandidate("a", "relevant", 0.8),
      makeCandidate("b", "irrelevant", 0.3),
    ];
    // sigmoid(2) ≈ 0.88, sigmoid(-2) ≈ 0.12 — only "a" passes minScore 0.5
    mockModelCall.mockResolvedValueOnce({ logits: { data: [2, -2] } });

    const result = await reranker.rerank("query", candidates);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("respects topK from constructor", async () => {
    const reranker = new CrossEncoderReranker({ topK: 2 });
    const candidates = [
      makeCandidate("a", "a"),
      makeCandidate("b", "b"),
      makeCandidate("c", "c"),
    ];
    mockModelCall.mockResolvedValueOnce({ logits: { data: [9.0, 8.0, 7.0] } });

    const result = await reranker.rerank("query", candidates);
    expect(result).toHaveLength(2);
  });

  it("respects topK override per call", async () => {
    const reranker = new CrossEncoderReranker({ topK: 10 });
    const candidates = [
      makeCandidate("a", "a"),
      makeCandidate("b", "b"),
      makeCandidate("c", "c"),
    ];
    mockModelCall.mockResolvedValueOnce({ logits: { data: [9.0, 8.0, 7.0] } });

    const result = await reranker.rerank("query", candidates, 1);
    expect(result).toHaveLength(1);
  });

  it("lazily initialises and caches the model across calls", async () => {
    const reranker = new CrossEncoderReranker();
    mockModelCall.mockResolvedValue({ logits: { data: [0.5] } });

    await reranker.rerank("q1", [makeCandidate("a", "text")]);
    await reranker.rerank("q2", [makeCandidate("b", "text")]);

    expect(mockFromPretrainedTokenizer).toHaveBeenCalledTimes(1);
    expect(mockFromPretrainedModel).toHaveBeenCalledTimes(1);
  });

  it("forwards custom model to AutoModelForSequenceClassification", async () => {
    const reranker = new CrossEncoderReranker({ model: "custom/model-v1" });
    mockModelCall.mockResolvedValue({ logits: { data: [0.5] } });

    await reranker.rerank("q", [makeCandidate("a", "text")]);
    expect(mockFromPretrainedTokenizer).toHaveBeenCalledWith("custom/model-v1");
    expect(mockFromPretrainedModel).toHaveBeenCalledWith("custom/model-v1", {
      dtype: "fp32",
    });
  });

  it("exposes name 'cross-encoder'", () => {
    expect(new CrossEncoderReranker().name).toBe("cross-encoder");
  });
});

describe("createReranker factory", () => {
  it("returns a CrossEncoderReranker", () => {
    const reranker = createReranker({});
    expect(reranker).toBeInstanceOf(CrossEncoderReranker);
  });

  it("forwards config options", () => {
    const reranker = createReranker({ topK: 3 }) as CrossEncoderReranker;
    expect(reranker.name).toBe("cross-encoder");
  });
});
