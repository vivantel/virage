import type {
  EmbeddingProvider,
  VectorStore,
  SearchOptions,
} from "../interfaces/index.js";
import type { Reranker } from "../interfaces/reranker.js";
import type { EvalDataset, EvalResult } from "../interfaces/quality.js";
import { computeEvalResult, reciprocalRank } from "./metrics.js";

export interface EvalRunResult {
  evalResult: EvalResult;
  /** Per-query reciprocal-rank scores for bootstrap significance testing. */
  perQueryRrScores: number[];
}

export interface EvalRunnerSearchConfig {
  hybrid?: boolean;
  hybridAlpha?: number;
  reranker?: Reranker;
  rerankOversample?: number;
}

export class EvalRunner {
  constructor(
    private readonly store: VectorStore,
    private readonly embedder: EmbeddingProvider,
    private readonly dataset: EvalDataset,
    private readonly topK = 10,
    private readonly searchConfig?: EvalRunnerSearchConfig,
  ) {}

  async run(
    onProgress?: (completed: number, total: number, query: string) => void,
  ): Promise<EvalRunResult> {
    const queryResults: Array<{
      retrievedIds: string[];
      relevantIds: Set<string>;
    }> = [];

    const oversample = this.searchConfig?.rerankOversample ?? 5;
    const fetchTopK = this.searchConfig?.reranker
      ? this.topK * oversample
      : this.topK;

    for (let qi = 0; qi < this.dataset.queries.length; qi++) {
      const evalQuery = this.dataset.queries[qi];
      const embedding = await this.embedder.embed(evalQuery.query);

      const searchOptions: SearchOptions = this.searchConfig?.hybrid
        ? {
            hybrid: true,
            hybridAlpha: this.searchConfig.hybridAlpha,
            queryText: evalQuery.query,
          }
        : {};

      let searchResults = await this.store.search(
        embedding,
        fetchTopK,
        undefined,
        searchOptions,
      );

      if (this.searchConfig?.reranker) {
        searchResults = await this.searchConfig.reranker.rerank(
          evalQuery.query,
          searchResults,
          this.topK,
        );
      }

      const relevantIds = new Set<string>();

      if (evalQuery.expectedChunkIds) {
        for (const id of evalQuery.expectedChunkIds) {
          relevantIds.add(id);
        }
      }

      const retrievedIds = searchResults.map((r) => r.id);

      // Substring match fallback
      if (evalQuery.expectedContent && evalQuery.expectedContent.length > 0) {
        for (const expected of evalQuery.expectedContent) {
          for (const result of searchResults) {
            if (
              result.denseText.includes(expected) ||
              result.sparseText.includes(expected)
            ) {
              relevantIds.add(result.id);
            }
          }
        }
      }

      queryResults.push({ retrievedIds, relevantIds });
      onProgress?.(qi + 1, this.dataset.queries.length, evalQuery.query);
    }

    const evalResult = computeEvalResult(queryResults);
    const perQueryRrScores = queryResults.map(({ retrievedIds, relevantIds }) =>
      reciprocalRank(retrievedIds, relevantIds),
    );

    return { evalResult, perQueryRrScores };
  }
}
