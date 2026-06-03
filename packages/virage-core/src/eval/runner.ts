import type { EmbeddingProvider, VectorStore } from "../interfaces/index.js";
import type { EvalDataset, EvalResult } from "../interfaces/quality.js";
import { computeEvalResult, reciprocalRank } from "./metrics.js";

export interface EvalRunResult {
  evalResult: EvalResult;
  /** Per-query reciprocal-rank scores for bootstrap significance testing. */
  perQueryRrScores: number[];
}

export class EvalRunner {
  constructor(
    private readonly store: VectorStore,
    private readonly embedder: EmbeddingProvider,
    private readonly dataset: EvalDataset,
    private readonly topK = 10,
  ) {}

  async run(
    onProgress?: (completed: number, total: number) => void,
  ): Promise<EvalRunResult> {
    const queryResults: Array<{
      retrievedIds: string[];
      relevantIds: Set<string>;
    }> = [];

    for (let qi = 0; qi < this.dataset.queries.length; qi++) {
      const evalQuery = this.dataset.queries[qi];
      const embedding = await this.embedder.embed(evalQuery.query);
      const searchResults = await this.store.search(embedding, this.topK);

      const relevantIds = new Set<string>();

      if (evalQuery.expectedChunkIds) {
        for (const id of evalQuery.expectedChunkIds) {
          relevantIds.add(id);
        }
      }

      // Resolve retrieved IDs: prefer contentHash from metadata, fall back to id
      const retrievedIds = searchResults.map(
        (r) => (r.metadata.contentHash as string | undefined) ?? r.id,
      );

      // Substring match fallback
      if (evalQuery.expectedContent && evalQuery.expectedContent.length > 0) {
        for (const expected of evalQuery.expectedContent) {
          for (const result of searchResults) {
            if (result.content.includes(expected)) {
              relevantIds.add(
                (result.metadata.contentHash as string | undefined) ??
                  result.id,
              );
            }
          }
        }
      }

      queryResults.push({ retrievedIds, relevantIds });
      onProgress?.(qi + 1, this.dataset.queries.length);
    }

    const evalResult = computeEvalResult(queryResults);
    const perQueryRrScores = queryResults.map(({ retrievedIds, relevantIds }) =>
      reciprocalRank(retrievedIds, relevantIds),
    );

    return { evalResult, perQueryRrScores };
  }
}
