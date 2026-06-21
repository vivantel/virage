import { describe, it, expect, vi, type MockedFunction } from "vitest";
import { EvalRunner } from "./runner.js";
import type { VectorStore, VectorSearchResult } from "../interfaces/index.js";
import type { Reranker } from "../interfaces/reranker.js";
import type { EvalDataset } from "../interfaces/quality.js";

function makeResult(id: string, content = ""): VectorSearchResult {
  return { id, content, metadata: {}, similarity: 1, sourceFile: "f.ts" };
}

function makeStore(
  results: VectorSearchResult[],
): VectorStore & { search: MockedFunction<VectorStore["search"]> } {
  return {
    name: "mock",
    initialize: vi.fn(),
    upsert: vi.fn(),
    deleteBySourceFile: vi.fn(),
    getCurrentState: vi.fn(),
    search: vi.fn().mockResolvedValue(results),
  } as unknown as VectorStore & {
    search: MockedFunction<VectorStore["search"]>;
  };
}

function makeEmbedder() {
  return { embed: vi.fn().mockResolvedValue([0.1, 0.2]), dimensions: 2 };
}

const dataset: EvalDataset = {
  queries: [
    { query: "find authentication", expectedChunkIds: ["auth-1"] },
    { query: "database schema", expectedChunkIds: ["db-2"] },
  ],
};

describe("EvalRunner — default (no search config)", () => {
  it("calls store.search with empty SearchOptions and topK", async () => {
    const store = makeStore([makeResult("auth-1"), makeResult("other")]);
    const embedder = makeEmbedder();
    const runner = new EvalRunner(store, embedder, dataset, 5);

    await runner.run();

    expect(store.search).toHaveBeenCalledTimes(2);
    expect(store.search).toHaveBeenCalledWith(
      expect.any(Array),
      5,
      undefined,
      {},
    );
  });

  it("computes correct MRR when first result is relevant", async () => {
    const store = makeStore([makeResult("auth-1"), makeResult("other")]);
    const embedder = makeEmbedder();
    const runner = new EvalRunner(store, embedder, dataset, 5);

    const { evalResult } = await runner.run();

    // query 1: auth-1 at position 1 → RR=1; query 2: db-2 missing → RR=0
    expect(evalResult.mrr).toBeCloseTo(0.5);
  });
});

describe("EvalRunner — hybrid search", () => {
  it("passes hybrid=true, hybridAlpha, and queryText to store.search", async () => {
    const store = makeStore([]);
    const embedder = makeEmbedder();
    const runner = new EvalRunner(store, embedder, dataset, 10, {
      hybrid: true,
      hybridAlpha: 0.6,
    });

    await runner.run();

    expect(store.search).toHaveBeenCalledWith(
      expect.any(Array),
      10,
      undefined,
      { hybrid: true, hybridAlpha: 0.6, queryText: "find authentication" },
    );
    expect(store.search).toHaveBeenCalledWith(
      expect.any(Array),
      10,
      undefined,
      { hybrid: true, hybridAlpha: 0.6, queryText: "database schema" },
    );
  });
});

describe("EvalRunner — reranker", () => {
  it("oversamples fetchTopK and calls reranker.rerank", async () => {
    const rawResults = [
      makeResult("other-1"),
      makeResult("auth-1"),
      makeResult("other-2"),
    ];
    const store = makeStore(rawResults);
    const reranker: Reranker = {
      name: "mock-reranker",
      rerank: vi
        .fn()
        .mockImplementation(
          (_query: string, candidates: VectorSearchResult[], k: number) =>
            Promise.resolve(candidates.slice(0, k)),
        ),
    };
    const embedder = makeEmbedder();
    const runner = new EvalRunner(store, embedder, dataset, 2, {
      reranker,
      rerankOversample: 3,
    });

    await runner.run();

    // fetchTopK = topK(2) * oversample(3) = 6
    expect(store.search).toHaveBeenCalledWith(
      expect.any(Array),
      6,
      undefined,
      {},
    );
    expect(reranker.rerank).toHaveBeenCalledTimes(2);
    expect(reranker.rerank).toHaveBeenCalledWith(
      "find authentication",
      rawResults,
      2,
    );
  });

  it("uses default oversample of 5 when rerankOversample is not set", async () => {
    const store = makeStore([]);
    const reranker: Reranker = {
      name: "mock-reranker",
      rerank: vi.fn().mockResolvedValue([]),
    };
    const embedder = makeEmbedder();
    const runner = new EvalRunner(store, embedder, dataset, 4, { reranker });

    await runner.run();

    expect(store.search).toHaveBeenCalledWith(
      expect.any(Array),
      20, // 4 * 5
      undefined,
      {},
    );
  });

  it("metrics reflect reranked order, not original search order", async () => {
    // Original order: [other, auth-1], reranker puts auth-1 first
    const original = [makeResult("other"), makeResult("auth-1")];
    const reranked = [makeResult("auth-1"), makeResult("other")];
    const store = makeStore(original);
    const reranker: Reranker = {
      name: "mock-reranker",
      rerank: vi.fn().mockResolvedValue(reranked),
    };
    const embedder = makeEmbedder();
    // Single-query dataset so the effect is clear
    const singleDataset: EvalDataset = {
      queries: [{ query: "auth", expectedChunkIds: ["auth-1"] }],
    };
    const runner = new EvalRunner(store, embedder, singleDataset, 2, {
      reranker,
    });

    const { evalResult, perQueryRrScores } = await runner.run();

    // auth-1 is first after reranking → RR = 1
    expect(perQueryRrScores[0]).toBe(1);
    expect(evalResult.mrr).toBe(1);
  });
});

describe("EvalRunner — hybrid + reranker combined", () => {
  it("sends hybrid options to search and also applies reranker", async () => {
    const store = makeStore([makeResult("auth-1")]);
    const reranker: Reranker = {
      name: "mock-reranker",
      rerank: vi.fn().mockResolvedValue([makeResult("auth-1")]),
    };
    const embedder = makeEmbedder();
    const runner = new EvalRunner(store, embedder, dataset, 5, {
      hybrid: true,
      hybridAlpha: 0.7,
      reranker,
      rerankOversample: 2,
    });

    await runner.run();

    expect(store.search).toHaveBeenCalledWith(
      expect.any(Array),
      10, // 5 * 2
      undefined,
      { hybrid: true, hybridAlpha: 0.7, queryText: "find authentication" },
    );
    expect(reranker.rerank).toHaveBeenCalled();
  });
});
