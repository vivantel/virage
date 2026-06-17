import type { VectorSearchResult } from "./vector-store.js";

export interface Reranker {
  readonly name: string;
  rerank(
    query: string,
    candidates: VectorSearchResult[],
    topK: number,
  ): Promise<VectorSearchResult[]>;
}
