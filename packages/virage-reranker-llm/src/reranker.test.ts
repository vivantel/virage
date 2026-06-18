import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VectorSearchResult } from "@vivantel/virage-core";
import { LlmReranker } from "./reranker.js";
import { createReranker } from "./index.js";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

function makeCandidate(
  id: string,
  content: string,
  similarity = 0.5,
): VectorSearchResult {
  return { id, content, similarity, metadata: {} };
}

function mockLlmResponse(indices: number[]) {
  mockCreate.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(indices) }],
  });
}

describe("LlmReranker", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns empty array immediately when no candidates given", async () => {
    const reranker = new LlmReranker();
    const result = await reranker.rerank("query", []);
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("reorders candidates according to LLM-returned indices", async () => {
    const reranker = new LlmReranker();
    const candidates = [
      makeCandidate("a", "least relevant"),
      makeCandidate("b", "most relevant"),
      makeCandidate("c", "middle"),
    ];
    mockLlmResponse([1, 2, 0]);

    const result = await reranker.rerank("query", candidates);
    expect(result.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("assigns descending similarity scores to reranked results", async () => {
    const reranker = new LlmReranker();
    const candidates = [
      makeCandidate("a", "a"),
      makeCandidate("b", "b"),
      makeCandidate("c", "c"),
    ];
    mockLlmResponse([2, 0, 1]);

    const result = await reranker.rerank("query", candidates);
    expect(result[0].similarity).toBeGreaterThan(result[1].similarity);
    expect(result[1].similarity).toBeGreaterThan(result[2].similarity);
  });

  it("respects topK from constructor", async () => {
    const reranker = new LlmReranker({ topK: 2 });
    const candidates = [
      makeCandidate("a", "a"),
      makeCandidate("b", "b"),
      makeCandidate("c", "c"),
    ];
    mockLlmResponse([0, 1, 2]);

    const result = await reranker.rerank("query", candidates);
    expect(result).toHaveLength(2);
  });

  it("respects topK override per call", async () => {
    const reranker = new LlmReranker({ topK: 10 });
    const candidates = [
      makeCandidate("a", "a"),
      makeCandidate("b", "b"),
      makeCandidate("c", "c"),
    ];
    mockLlmResponse([0, 1, 2]);

    const result = await reranker.rerank("query", candidates, 1);
    expect(result).toHaveLength(1);
  });

  it("falls back to original order when API throws", async () => {
    const reranker = new LlmReranker();
    const candidates = [makeCandidate("a", "a"), makeCandidate("b", "b")];
    mockCreate.mockRejectedValue(new Error("API error"));

    const result = await reranker.rerank("query", candidates);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("falls back to original order when LLM returns no JSON array", async () => {
    const reranker = new LlmReranker();
    const candidates = [makeCandidate("a", "a"), makeCandidate("b", "b")];
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot rank these." }],
    });

    const result = await reranker.rerank("query", candidates);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("ignores out-of-range indices from LLM", async () => {
    const reranker = new LlmReranker();
    const candidates = [makeCandidate("a", "a"), makeCandidate("b", "b")];
    mockLlmResponse([99, 0, 1]);

    const result = await reranker.rerank("query", candidates);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("ignores duplicate indices from LLM", async () => {
    const reranker = new LlmReranker();
    const candidates = [makeCandidate("a", "a"), makeCandidate("b", "b")];
    mockLlmResponse([0, 0, 1]);

    const result = await reranker.rerank("query", candidates);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result).toHaveLength(2);
  });

  it("appends candidates not mentioned by LLM at the end", async () => {
    const reranker = new LlmReranker({ topK: 10 });
    const candidates = [
      makeCandidate("a", "a"),
      makeCandidate("b", "b"),
      makeCandidate("c", "c"),
    ];
    mockLlmResponse([2]); // only mentions index 2

    const result = await reranker.rerank("query", candidates);
    expect(result[0].id).toBe("c");
    expect(result.map((r) => r.id)).toContain("a");
    expect(result.map((r) => r.id)).toContain("b");
  });

  it("exposes name 'llm'", () => {
    expect(new LlmReranker().name).toBe("llm");
  });
});

describe("createReranker factory", () => {
  it("returns an LlmReranker instance", () => {
    const reranker = createReranker({});
    expect(reranker).toBeInstanceOf(LlmReranker);
  });
});
