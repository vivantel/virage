import { homedir } from "node:os";
import { join } from "node:path";
import type { EmbeddingProvider, Logger } from "@vivantel/virage-core";

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
  private readonly cacheDir: string;
  private readonly quantization?: QuantizationOptions;
  private _pipelinePromise: Promise<Pipeline> | null = null;
  private logger: Logger | null = null;

  constructor(options: TransformersEmbedderOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions ?? 384;
    this.device = options.device ?? "cpu";
    // Default to the user's home directory so globally-installed packages
    // (owned by root) don't try to write the model cache inside node_modules.
    this.cacheDir =
      options.cacheDir ?? join(homedir(), ".cache", "huggingface", "hub");
    this.quantization = options.quantization;
  }

  setLogger(logger: Logger): void {
    this.logger = logger.withTag("transformers");
  }

  async preWarm(
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    if (!this._pipelinePromise) {
      this._pipelinePromise = this._loadPipeline(onProgress);
    }
    await this._pipelinePromise;
  }

  private getPipeline(): Promise<Pipeline> {
    if (!this._pipelinePromise) {
      this._pipelinePromise = this._loadPipeline();
    }
    return this._pipelinePromise;
  }

  private async _loadPipeline(
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Pipeline> {
    this.logger?.info(`Loading model ${this.model}`);
    this.logger?.debug(
      `Device: ${this.device}${this.quantization ? `, dtype: ${this.quantization.dtype}` : ""}`,
    );

    // Lazy import — consumers must install @huggingface/transformers
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = this.cacheDir;

    // Track per-file download progress and aggregate into a single callback
    const fileTotals = new Map<string, number>();
    const fileLoaded = new Map<string, number>();
    const progressCallback = onProgress
      ? (event: {
          status: string;
          name?: string;
          loaded?: number;
          total?: number;
        }) => {
          if (
            event.status === "progress" &&
            event.name &&
            typeof event.loaded === "number" &&
            typeof event.total === "number" &&
            event.total > 0
          ) {
            fileTotals.set(event.name, event.total);
            fileLoaded.set(event.name, event.loaded);
            const sumTotal = [...fileTotals.values()].reduce(
              (a, b) => a + b,
              0,
            );
            const sumLoaded = [...fileLoaded.values()].reduce(
              (a, b) => a + b,
              0,
            );
            onProgress(sumLoaded, sumTotal);
          }
        }
      : undefined;

    const pipe = (await pipeline("feature-extraction", this.model, {
      device: this.device,
      ...(this.quantization ? { dtype: this.quantization.dtype } : {}),
      ...(progressCallback ? { progress_callback: progressCallback } : {}),
    })) as unknown as Pipeline;

    // Ensure the progress bar reaches 100% — download events only fire for
    // shards that aren't cached, so the bar may be stuck at a low value when
    // the model loads from disk with no network activity.
    if (onProgress) {
      const sumTotal = [...fileTotals.values()].reduce((a, b) => a + b, 0);
      const final = sumTotal > 0 ? sumTotal : 1;
      onProgress(final, final);
    }

    this.logger?.info(
      `Model ${this.model} ready (${this.dimensions}d, device=${this.device})`,
    );
    return pipe;
  }

  async embed(text: string): Promise<number[]> {
    const pipe = await this.getPipeline();
    const output = await pipe([text], { pooling: "mean", normalize: true });
    return Array.from(output.data.slice(0, this.dimensions)) as number[];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipe = await this.getPipeline();
    this.logger?.verbose(`Batch ${texts.length} texts`);
    this.logger?.trace(
      `Text lengths: ${texts.map((t) => t.length).join(", ")}`,
    );
    const start = Date.now();
    const output = await pipe(texts, { pooling: "mean", normalize: true });
    this.logger?.debug(
      `Batch inference: ${Date.now() - start}ms for ${texts.length} texts`,
    );
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
