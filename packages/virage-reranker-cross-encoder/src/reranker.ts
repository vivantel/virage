import type { Reranker, VectorSearchResult } from "@vivantel/virage-core";

export interface CrossEncoderRerankerOptions {
  /** HuggingFace model ID. Defaults to "Xenova/ms-marco-MiniLM-L-6-v2". */
  model?: string;
  /** Number of results to return after re-ranking. Defaults to 5. */
  topK?: number;
}

export class CrossEncoderReranker implements Reranker {
  readonly name = "cross-encoder";

  private readonly modelId: string;
  private readonly defaultTopK: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _pipeline: any = null;

  constructor(options: CrossEncoderRerankerOptions = {}) {
    this.modelId = options.model ?? "Xenova/ms-marco-MiniLM-L-6-v2";
    this.defaultTopK = options.topK ?? 5;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getPipeline(): Promise<any> {
    if (!this._pipeline) {
      const { pipeline } = await import("@huggingface/transformers");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this._pipeline = await (pipeline as any)("text-ranking", this.modelId);
    }
    return this._pipeline;
  }

  async rerank(
    query: string,
    candidates: VectorSearchResult[],
    topK?: number,
  ): Promise<VectorSearchResult[]> {
    if (candidates.length === 0) return [];
    const k = topK ?? this.defaultTopK;

    const pipe = await this.getPipeline();
    const inputs = candidates.map((c) => ({
      text: query,
      text_pair: c.content,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outputs: any = await pipe(inputs);

    return candidates
      .map((c, i) => ({
        ...c,
        similarity: Array.isArray(outputs)
          ? ((outputs[i] as { score: number } | undefined)?.score ??
            c.similarity)
          : c.similarity,
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }
}
