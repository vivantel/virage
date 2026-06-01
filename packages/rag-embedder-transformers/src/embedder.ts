import type { EmbeddingProvider } from "@vivantel/rag-core";

export interface QuantizationOptions {
  /** Data type for model quantization. Reduces memory usage at small quality cost. */
  dtype: "int8" | "uint8" | "fp16" | "q4";
  threads?: number;
}

export interface TransformersEmbedderOptions {
  /** HuggingFace model ID, e.g. "Xenova/all-MiniLM-L6-v2" */
  model: string;
  /** Output vector dimensions. Auto-detected from the model if omitted. */
  dimensions?: number;
  device?: "cpu" | "webgpu";
  /** Local directory for caching downloaded models. */
  cacheDir?: string;
  /** Optional quantization settings. Reduces RAM usage by 60-75%, speeds up inference. */
  quantization?: QuantizationOptions;
}

type Pipeline = {
  (
    texts: string[] | string,
    opts?: { pooling?: string; normalize?: boolean },
  ): Promise<{
    data: Float32Array;
  }>;
};

export class TransformersEmbedder implements EmbeddingProvider {
  readonly name = "transformers";
  readonly dimensions: number;
  readonly model: string;
  readonly preferredBatchSize = 32;

  private readonly device: "cpu" | "webgpu";
  private readonly cacheDir?: string;
  private readonly quantization?: QuantizationOptions;
  private _pipeline: Pipeline | null = null;

  constructor(options: TransformersEmbedderOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions ?? 384;
    this.device = options.device ?? "cpu";
    this.cacheDir = options.cacheDir;
    this.quantization = options.quantization;
  }

  private async getPipeline(): Promise<Pipeline> {
    if (this._pipeline) return this._pipeline;

    // Lazy import — consumers must install @huggingface/transformers
    const { pipeline, env } = await import("@huggingface/transformers");

    if (this.cacheDir) {
      env.cacheDir = this.cacheDir;
    }

    this._pipeline = (await pipeline("feature-extraction", this.model, {
      device: this.device,
      ...(this.quantization ? { dtype: this.quantization.dtype } : {}),
    })) as unknown as Pipeline;

    return this._pipeline;
  }

  async embed(text: string): Promise<number[]> {
    const pipe = await this.getPipeline();
    const output = await pipe([text], { pooling: "mean", normalize: true });
    return Array.from(output.data.slice(0, this.dimensions)) as number[];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipe = await this.getPipeline();
    const output = await pipe(texts, { pooling: "mean", normalize: true });
    const stride = output.data.length / texts.length;
    const result: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      result.push(
        Array.from(
          output.data.slice(i * stride, i * stride + this.dimensions),
        ) as number[],
      );
    }
    return result;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.getPipeline();
      return true;
    } catch {
      return false;
    }
  }
}
