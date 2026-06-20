import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VectorSearchResult } from "@vivantel/virage-core";
import { CrossEncoderReranker } from "./reranker.js";
import { createReranker } from "./index.js";

const mockCall = vi.fn();
const mockPipelineFactory = vi.fn().mockResolvedValue({ _call: mockCall });

vi.mock("@huggingface/transformers", () => ({
  pipeline: mockPipelineFactory,
}));

function makeCandidate(
  id: string,
  content: string,
  similarity = 0.5,
): VectorSearchResult {
  return { id, content, similarity, metadata: {} };
}

describe("CrossEncoderReranker", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockPipelineFactory.mockClear();
  });

  it("returns empty array immediately when no candidates given", async () => {
    const reranker = new CrossEncoderReranker();
    const result = await reranker.rerank("some query", []);
    expect(result).toEqual([]);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("requests raw logits via function_to_apply: none", async () => {
    const reranker = new CrossEncoderReranker();
    mockCall.mockResolvedValue([[{ score: 5.2 }]]);

    await reranker.rerank("q", [makeCandidate("a", "text")]);
    expect(mockCall).toHaveBeenCalledWith(expect.any(Array), {
      function_to_apply: "none",
    });
  });

  it("reorders candidates by raw logit descending", async () => {
    const reranker = new CrossEncoderReranker();
    const candidates = [
      makeCandidate("a", "low relevance", 0.8),
      makeCandidate("b", "high relevance", 0.3),
      makeCandidate("c", "medium relevance", 0.5),
    ];
    // Raw logits (not sigmoid/softmax) — higher = more relevant
    mockCall.mockResolvedValue([
      [{ score: -3.0 }], // a: not relevant
      [{ score: 8.5 }], // b: highly relevant
      [{ score: 2.1 }], // c: somewhat relevant
    ]);

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
    mockCall.mockResolvedValue([
      [{ score: 0.1 }], // a: sigmoid(0.1) ≈ 0.525
      [{ score: 0.9 }], // b: sigmoid(0.9) ≈ 0.711
      [{ score: 0.5 }], // c: sigmoid(0.5) ≈ 0.622
    ]);

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
    mockCall.mockResolvedValue([[{ score: 7.3 }]]);

    const result = await reranker.rerank("query", candidates);
    // sigmoid(7.3) ≈ 0.9993 — very high but not exactly 1
    expect(result[0].similarity).toBeCloseTo(1 / (1 + Math.exp(-7.3)), 5);
    expect(result[0].similarity).toBeGreaterThan(0.99);
  });

  it("assigns near-zero similarity to highly negative logit", async () => {
    const reranker = new CrossEncoderReranker();
    const candidates = [makeCandidate("x", "irrelevant content", 0.5)];
    mockCall.mockResolvedValue([[{ score: -8 }]]);

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
    mockCall.mockResolvedValue([[{ score: 2 }], [{ score: -2 }]]);

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
    mockCall.mockResolvedValue([
      [{ score: 9.0 }],
      [{ score: 8.0 }],
      [{ score: 7.0 }],
    ]);

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
    mockCall.mockResolvedValue([
      [{ score: 9.0 }],
      [{ score: 8.0 }],
      [{ score: 7.0 }],
    ]);

    const result = await reranker.rerank("query", candidates, 1);
    expect(result).toHaveLength(1);
  });

  it("lazily initialises and caches the pipeline across calls", async () => {
    const reranker = new CrossEncoderReranker();
    mockCall.mockResolvedValue([[{ score: 0.5 }]]);

    await reranker.rerank("q1", [makeCandidate("a", "text")]);
    await reranker.rerank("q2", [makeCandidate("b", "text")]);

    expect(mockPipelineFactory).toHaveBeenCalledTimes(1);
  });

  it("forwards custom model to the pipeline factory", async () => {
    const reranker = new CrossEncoderReranker({ model: "custom/model-v1" });
    mockCall.mockResolvedValue([[{ score: 0.5 }]]);

    await reranker.rerank("q", [makeCandidate("a", "text")]);
    expect(mockPipelineFactory).toHaveBeenCalledWith(
      "text-classification",
      "custom/model-v1",
      { dtype: "fp32" },
    );
  });

  it("preserves original similarity when pipeline returns no scores", async () => {
    const reranker = new CrossEncoderReranker();
    const candidates = [makeCandidate("a", "content", 0.42)];
    mockCall.mockResolvedValue("unexpected non-array");

    const result = await reranker.rerank("q", candidates);
    expect(result[0].similarity).toBe(0.42);
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
