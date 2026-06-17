import type { VectorSearchResult } from "../interfaces/vector-store.js";

const RRF_K = 60;

/**
 * Reciprocal Rank Fusion of two result lists.
 *
 * hybridAlpha: 0 = pure BM25, 1 = pure vector. Default 0.6.
 */
export function rrfMerge(
  vectorResults: VectorSearchResult[],
  bm25Results: VectorSearchResult[],
  topK: number,
  hybridAlpha = 0.6,
): VectorSearchResult[] {
  const scores = new Map<string, number>();
  const byId = new Map<string, VectorSearchResult>();

  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i];
    scores.set(
      r.id,
      (scores.get(r.id) ?? 0) + hybridAlpha * (1 / (RRF_K + i + 1)),
    );
    byId.set(r.id, r);
  }

  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i];
    scores.set(
      r.id,
      (scores.get(r.id) ?? 0) + (1 - hybridAlpha) * (1 / (RRF_K + i + 1)),
    );
    if (!byId.has(r.id)) byId.set(r.id, r);
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, score]) => ({ ...byId.get(id)!, similarity: score }));
}
