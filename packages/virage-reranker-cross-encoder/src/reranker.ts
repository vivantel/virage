import type { Reranker, VectorSearchResult } from "@vivantel/virage-core";

export interface CrossEncoderRerankerOptions {
  /** HuggingFace model ID. Defaults to "Xenova/ms-marco-MiniLM-L-6-v2". */
  model?: string;
  /** Number of results to return after re-ranking. Defaults to 5. */
  topK?: number;
  /**
   * Minimum sigmoid-calibrated relevance score (0–1) to include in results.
   * Results below this threshold are dropped. Default: 0 (no filtering).
   */
  minScore?: number;
}

// Minimal structural types for the low-level HuggingFace transformers API
type Tokenizer = {
  (
    text: string | string[],
    opts: {
      text_pair: string | string[];
      padding: boolean;
      truncation: boolean;
    },
  ): unknown;
};

type SequenceClassificationModel = {
  (inputs: unknown): Promise<{ logits: { data: ArrayLike<number> } }>;
};

export class CrossEncoderReranker implements Reranker {
  readonly name = "cross-encoder";

  private readonly modelId: string;
  private readonly defaultTopK: number;
  private readonly minScore: number;
  private _tokenizer: Tokenizer | null = null;
  private _model: SequenceClassificationModel | null = null;

  constructor(options: CrossEncoderRerankerOptions = {}) {
    this.modelId = options.model ?? "Xenova/ms-marco-MiniLM-L-6-v2";
    this.defaultTopK = options.topK ?? 5;
    this.minScore = options.minScore ?? 0;
  }

  private async load(): Promise<{
    tokenizer: Tokenizer;
    model: SequenceClassificationModel;
  }> {
    if (!this._tokenizer || !this._model) {
      const { AutoTokenizer, AutoModelForSequenceClassification } =
        await import("@huggingface/transformers");
      this._tokenizer = (await AutoTokenizer.from_pretrained(
        this.modelId,
      )) as unknown as Tokenizer;
      this._model = (await AutoModelForSequenceClassification.from_pretrained(
        this.modelId,
        {
          dtype: "fp32",
        },
      )) as unknown as SequenceClassificationModel;
    }
    return { tokenizer: this._tokenizer!, model: this._model! };
  }

  async rerank(
    query: string,
    candidates: VectorSearchResult[],
    topK?: number,
  ): Promise<VectorSearchResult[]> {
    if (candidates.length === 0) return [];
    const k = topK ?? this.defaultTopK;

    const { tokenizer, model } = await this.load();
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

    // Batch all (query, document) pairs into a single forward pass.
    // ms-marco cross-encoders return one logit per pair; batching reduces
    // N ONNX inference calls to 1 with no effect on scores.
    const queries = candidates.map(() => query);
    const docs = candidates.map((c) => c.denseText);
    const inputs = tokenizer(queries, {
      text_pair: docs,
      padding: true,
      truncation: true,
    });
    const output = await model(inputs);
    const logits = output.logits.data as Float32Array;
    const scored = candidates.map((c, i) => ({
      c,
      similarity: sigmoid(logits[i]!),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);
    const top = scored
      .slice(0, k)
      .map(({ c, similarity }) => ({ ...c, similarity }));

    return this.minScore > 0
      ? top.filter((r) => r.similarity >= this.minScore)
      : top;
  }
}
