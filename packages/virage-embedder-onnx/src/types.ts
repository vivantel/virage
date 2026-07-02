export interface OnnxEmbedderOptions {
  /**
   * Local directory containing model.onnx + tokenizer.json,
   * OR a HuggingFace model ID (e.g. "sentence-transformers/all-MiniLM-L6-v2")
   * for automatic download.
   */
  model: string;

  /** Override tokenizer.json path when not co-located with model.onnx. */
  tokenizerPath?: string;

  /** Output embedding dimensions — must match the model's output size. */
  dimensions: number;

  /**
   * ONNX execution provider. Defaults to "cpu".
   * Use "cuda" or "tensorrt" for GPU inference (requires onnxruntime-gpu peer).
   */
  executionProvider?: "cpu" | "cuda" | "directml" | "tensorrt" | "rocm";

  /** GPU device index when using a GPU execution provider. Defaults to 0. */
  deviceId?: number;

  /** Number of intra-op threads. Defaults to CPU core count. */
  numThreads?: number;

  /**
   * ONNX graph optimization level.
   * 0 = disabled, 1 = basic, 2 = extended, 3 = all. Defaults to 3.
   */
  graphOptimizationLevel?: 0 | 1 | 2 | 3;

  /**
   * Pooling strategy for converting token embeddings to a sentence vector.
   * "mean" averages all token embeddings (recommended for sentence transformers).
   * "cls" uses the [CLS] token embedding (recommended for BERT-style classifiers).
   * Defaults to "mean".
   */
  pooling?: "mean" | "cls";

  /** Apply L2 normalization to the output vector. Defaults to true. */
  normalize?: boolean;

  /** Maximum number of tokens per input sequence. Defaults to 512. */
  maxSequenceLength?: number;

  /**
   * Directory for caching downloaded HuggingFace models.
   * Defaults to $VIRAGE_MODELS_DIR or ~/.virage/models.
   */
  cacheDir?: string;
}
