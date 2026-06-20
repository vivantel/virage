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
      this._pipeline = await pipeline("text-classification", this.modelId, {
        dtype: "fp32",
      });
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
        const rawResult = Array.isArray(result) ? result[0] : result;
        const typed = rawResult as
          | { label?: string; score?: number }
          | undefined;
        let score: number | undefined;
        if (typed?.score !== undefined) {
          // For 2-class relevance models: LABEL_1 = relevant, LABEL_0 = not-relevant.
          // The pipeline returns the top label; if LABEL_0 wins we invert to get relevance.
          score = typed.label === "LABEL_0" ? 1 - typed.score : typed.score;
        }
        return {
          ...c,
          similarity: score ?? c.similarity,
        };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }
}
