/**
 * Pure retrieval evaluation metric functions.
 * No I/O, no side effects — easy to unit-test in isolation.
 */

import type { EvalResult } from "../interfaces/quality.js";

/**
 * Precision@K: fraction of the top-K retrieved items that are relevant.
 */
export function precisionAtK(
  retrieved: string[],
  relevant: Set<string>,
  k: number,
): number {
  if (k <= 0) return 0;
  const topK = retrieved.slice(0, k);
  const hits = topK.filter((id) => relevant.has(id)).length;
  return hits / k;
}

/**
 * Recall@K: fraction of relevant items found in the top-K retrieved items.
 */
export function recallAtK(
  retrieved: string[],
  relevant: Set<string>,
  k: number,
): number {
  if (relevant.size === 0) return 0;
  const topK = retrieved.slice(0, k);
  const hits = topK.filter((id) => relevant.has(id)).length;
  return hits / relevant.size;
}

/**
 * Reciprocal Rank: 1 / rank of the first relevant result (0 if none).
 */
export function reciprocalRank(
  retrieved: string[],
  relevant: Set<string>,
): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.has(retrieved[i])) return 1 / (i + 1);
  }
  return 0;
}

/**
 * HitRate@K: 1 if at least one relevant result is in the top-K, else 0.
 */
export function hitRateAtK(
  retrieved: string[],
  relevant: Set<string>,
  k: number,
): number {
  return retrieved.slice(0, k).some((id) => relevant.has(id)) ? 1 : 0;
}

interface PerQueryMetrics {
  precisionAt5: number;
  precisionAt10: number;
  recallAt10: number;
  rr: number;
  hitRateAt5: number;
}

/**
 * Average per-query metrics into a single EvalResult.
 */
export function aggregateEvalResults(perQuery: PerQueryMetrics[]): EvalResult {
  if (perQuery.length === 0) {
    return {
      precisionAt5: 0,
      precisionAt10: 0,
      recallAt10: 0,
      mrr: 0,
      hitRateAt5: 0,
      queriesEvaluated: 0,
    };
  }

  const n = perQuery.length;
  const sum = perQuery.reduce(
    (acc, q) => ({
      precisionAt5: acc.precisionAt5 + q.precisionAt5,
      precisionAt10: acc.precisionAt10 + q.precisionAt10,
      recallAt10: acc.recallAt10 + q.recallAt10,
      rr: acc.rr + q.rr,
      hitRateAt5: acc.hitRateAt5 + q.hitRateAt5,
    }),
    { precisionAt5: 0, precisionAt10: 0, recallAt10: 0, rr: 0, hitRateAt5: 0 },
  );

  return {
    precisionAt5: sum.precisionAt5 / n,
    precisionAt10: sum.precisionAt10 / n,
    recallAt10: sum.recallAt10 / n,
    mrr: sum.rr / n,
    hitRateAt5: sum.hitRateAt5 / n,
    queriesEvaluated: n,
  };
}

/**
 * Compute per-query metrics and aggregate them.
 *
 * @param queries - array of `{ retrievedIds, relevantIds }` per query
 */
export function computeEvalResult(
  queries: Array<{ retrievedIds: string[]; relevantIds: Set<string> }>,
): EvalResult {
  const perQuery: PerQueryMetrics[] = queries.map(
    ({ retrievedIds, relevantIds }) => ({
      precisionAt5: precisionAtK(retrievedIds, relevantIds, 5),
      precisionAt10: precisionAtK(retrievedIds, relevantIds, 10),
      recallAt10: recallAtK(retrievedIds, relevantIds, 10),
      rr: reciprocalRank(retrievedIds, relevantIds),
      hitRateAt5: hitRateAtK(retrievedIds, relevantIds, 5),
    }),
  );

  return aggregateEvalResults(perQuery);
}
