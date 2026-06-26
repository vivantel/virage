import type { EmbeddingProvider, VectorStore } from "../interfaces/index.js";
import type { Reranker } from "../interfaces/reranker.js";
import type { EvalDataset } from "../interfaces/quality.js";
import { EvalRunner } from "./runner.js";
import type { EvalRunnerSearchConfig } from "./runner.js";

/**
 * Query-time parameters that can be tuned without re-indexing.
 * Index-time parameters (chunk size, overlap) require re-chunking + re-embedding
 * and cannot be grid-searched against a fixed store.
 */
export interface AdaptiveTuningSearchSpace {
  /** BM25/vector blend ratio (0 = all BM25, 1 = all vector). Implies hybrid=true. */
  hybridAlpha?: number[];
  /** Result set size returned per query. */
  topK?: number[];
  /**
   * Candidate multiplier fed to the reranker before trimming to topK.
   * Only meaningful when `reranker` is set. E.g. 5 → fetch topK*5 candidates.
   */
  rerankOversample?: number[];
}

export interface AdaptiveTuningConfig {
  searchSpace: AdaptiveTuningSearchSpace;
  dataset: EvalDataset;
  store: VectorStore;
  embedder: EmbeddingProvider;
  /** Optional reranker applied after retrieval at each grid point. */
  reranker?: Reranker;
}

export interface TuningParams {
  hybridAlpha: number;
  topK: number;
  rerankOversample: number;
}

export interface AdaptiveTuningResult {
  bestParams: TuningParams;
  bestMrr: number;
  runs: Array<{ params: TuningParams; mrr: number }>;
}

export async function runAdaptiveTuning(
  config: AdaptiveTuningConfig,
): Promise<AdaptiveTuningResult> {
  const { searchSpace, dataset, store, embedder, reranker } = config;

  const hybridAlphas = searchSpace.hybridAlpha ?? [0.6];
  const topKs = searchSpace.topK ?? [10];
  const oversampleFactors = searchSpace.rerankOversample ?? [5];

  const grid: TuningParams[] = [];
  for (const hybridAlpha of hybridAlphas) {
    for (const topK of topKs) {
      for (const rerankOversample of oversampleFactors) {
        grid.push({ hybridAlpha, topK, rerankOversample });
      }
    }
  }

  const runs: AdaptiveTuningResult["runs"] = [];
  let bestMrr = -1;
  let bestParams: TuningParams = grid[0]!;

  for (const params of grid) {
    const searchConfig: EvalRunnerSearchConfig = {
      hybrid: true,
      hybridAlpha: params.hybridAlpha,
      ...(reranker
        ? { reranker, rerankOversample: params.rerankOversample }
        : {}),
    };
    const runner = new EvalRunner(
      store,
      embedder,
      dataset,
      params.topK,
      searchConfig,
    );
    const { evalResult } = await runner.run();
    runs.push({ params, mrr: evalResult.mrr });

    if (evalResult.mrr > bestMrr) {
      bestMrr = evalResult.mrr;
      bestParams = params;
    }
  }

  return { bestParams, bestMrr, runs };
}
