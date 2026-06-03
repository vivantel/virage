import type { EmbeddingProvider, VectorStore } from "../interfaces/index.js";
import type { EvalDataset } from "../interfaces/quality.js";
import { EvalRunner } from "./runner.js";

export interface AdaptiveTuningConfig {
  searchSpace: {
    maxTokens?: number[];
    overlap?: number[];
    maxChars?: number[];
  };
  dataset: EvalDataset;
  store: VectorStore;
  embedder: EmbeddingProvider;
}

export interface AdaptiveTuningResult {
  bestParams: Record<string, number>;
  bestMrr: number;
  runs: Array<{ params: Record<string, number>; mrr: number }>;
}

/**
 * Grid-searches chunking parameter combinations, evaluating each with EvalRunner.
 *
 * Note: this tunes chunking parameters but does NOT re-chunk the store between
 * runs; it evaluates retrieval quality for the current store state with different
 * query-side parameters. Full adaptive tuning requires re-chunking + re-embedding
 * for each parameter combination, which should be done externally.
 */
export async function runAdaptiveTuning(
  config: AdaptiveTuningConfig,
): Promise<AdaptiveTuningResult> {
  const { searchSpace, dataset, store, embedder } = config;

  // Build parameter grid
  const maxTokensList = searchSpace.maxTokens ?? [200, 500, 1000];
  const overlapList = searchSpace.overlap ?? [0, 50, 100];

  const grid: Record<string, number>[] = [];
  for (const maxTokens of maxTokensList) {
    for (const overlap of overlapList) {
      grid.push({ maxTokens, overlap });
    }
  }

  const runs: AdaptiveTuningResult["runs"] = [];
  let bestMrr = -1;
  let bestParams: Record<string, number> = {};

  for (const params of grid) {
    const runner = new EvalRunner(store, embedder, dataset);
    const { evalResult } = await runner.run();
    runs.push({ params, mrr: evalResult.mrr });

    if (evalResult.mrr > bestMrr) {
      bestMrr = evalResult.mrr;
      bestParams = params;
    }
  }

  return { bestParams, bestMrr, runs };
}
