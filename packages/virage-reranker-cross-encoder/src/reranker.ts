import type { Reranker, VectorSearchResult } from "@vivantel/virage-core";

export interface CrossEncoderRerankerOptions {
  /** HuggingFace model ID. Defaults to "Xenova/ms-marco-MiniLM-L-6-v2". */
  model?: string;
  /** Number of results to return after re-ranking. Defaults to 5. */
  topK?: number;
}

// Minimal structural type matching text-classification pipeline's runtime batch behaviour
type Classifier = { _call(inputs: unknown): Promise<unknown> };

export class CrossEncoderReranker implements Reranker {
  readonly name = "cross-encoder";

  private readonly modelId: string;
  private readonly defaultTopK: number;
  private _pipeline: Classifier | null = null;

  constructor(options: CrossEncoderRerankerOptions = {}) {
    this.modelId = options.model ?? "Xenova/ms-marco-MiniLM-L-6-v2";
    this.defaultTopK = options.topK ?? 5;
  }

  private async getPipeline(): Promise<Classifier> {
    if (!this._pipeline) {
      const { pipeline } = await import("@huggingface/transformers");
      this._pipeline = await pipeline("text-classification", this.modelId);
    }
    return this._pipeline!;
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
    const outputs: unknown = await pipe._call(inputs);

    return candidates
      .map((c, i) => {
        const result = Array.isArray(outputs) ? outputs[i] : undefined;
        const score = Array.isArray(result) ? result[0]?.score : result?.score;
        return {
          ...c,
          similarity: (score as number | undefined) ?? c.similarity,
        };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }
}
