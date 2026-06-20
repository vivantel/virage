import type { Reranker, VectorSearchResult } from "@vivantel/virage-core";

export interface CrossEncoderRerankerOptions {
  /** HuggingFace model ID. Defaults to "Xenova/ms-marco-MiniLM-L-6-v2". */
  model?: string;
  /** Number of results to return after re-ranking. Defaults to 5. */
  topK?: number;
}

// Minimal structural type matching text-classification pipeline's runtime batch behaviour
type Classifier = {
  _call(
    inputs: unknown,
    opts?: { function_to_apply?: string },
  ): Promise<unknown>;
};

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
      this._pipeline = (await pipeline("text-classification", this.modelId, {
        dtype: "fp32",
      })) as unknown as Classifier;
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
    // Request raw logits (no sigmoid/softmax) so scores are not saturated at 1.0
    // for all inputs. The ms-marco cross-encoder produces logits in roughly [-10, 10];
    // normalizing within the batch gives meaningful relative similarities.
    const outputs: unknown = await pipe._call(inputs, {
      function_to_apply: "none",
    });

    // Extract raw logit for each candidate
    const indexed = candidates.map((c, i) => {
      const result = Array.isArray(outputs) ? outputs[i] : undefined;
      const raw = Array.isArray(result) ? result[0] : result;
      const typed = raw as { score?: number } | undefined;
      return { c, logit: typed?.score };
    });

    // If the pipeline returned no usable scores, preserve original order and similarities
    if (!indexed.some((x) => x.logit !== undefined)) {
      return candidates.slice(0, k).map((c) => ({ ...c }));
    }

    // Sort by logit descending (higher raw score = more relevant)
    indexed.sort(
      (a, b) => (b.logit ?? b.c.similarity) - (a.logit ?? a.c.similarity),
    );
    const top = indexed.slice(0, k);

    // Min-max normalize logits to [0, 1] for display, preserving ranking order
    const logits = top.map((x) => x.logit ?? x.c.similarity);
    const min = Math.min(...logits);
    const max = Math.max(...logits);
    const range = max - min;

    return top.map((x, i) => ({
      ...x.c,
      similarity: range > 1e-9 ? (logits[i] - min) / range : 1,
    }));
  }
}
