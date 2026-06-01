import type { EmbeddingProvider } from "@vivantel/rag-core";

export interface FastEmbedEmbedderOptions {
  /** FastEmbed model name, e.g. "BAAI/bge-small-en-v1.5" */
  model?: string;
  /** Output vector dimensions. Defaults based on model. */
  dimensions?: number;
  /** Local directory for caching downloaded models. */
  cacheDir?: string;
  showDownloadProgress?: boolean;
}

type FastEmbedModel = {
  embed(texts: string[]): AsyncGenerator<number[][]>;
};

type FastEmbedModule = {
  EmbeddingModel: new (opts: {
    model?: string;
    cacheDir?: string;
    showDownloadProgress?: boolean;
  }) => FastEmbedModel;
};

const DEFAULT_MODEL = "BAAI/bge-small-en-v1.5";
const DEFAULT_DIMENSIONS: Record<string, number> = {
  "BAAI/bge-small-en-v1.5": 384,
  "BAAI/bge-base-en-v1.5": 768,
  "BAAI/bge-large-en-v1.5": 1024,
  "nomic-ai/nomic-embed-text-v1.5": 768,
};

export class FastEmbedEmbedder implements EmbeddingProvider {
  readonly name = "fastembed";
  readonly dimensions: number;
  readonly model: string;
  readonly preferredBatchSize = 256;

  private readonly cacheDir?: string;
  private readonly showDownloadProgress: boolean;
  private _inner: FastEmbedModel | null = null;

  constructor(options: FastEmbedEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.dimensions =
      options.dimensions ?? DEFAULT_DIMENSIONS[this.model] ?? 384;
    this.cacheDir = options.cacheDir;
    this.showDownloadProgress = options.showDownloadProgress ?? false;
  }

  private async getModel(): Promise<FastEmbedModel> {
    if (this._inner) return this._inner;

    // Lazy import — consumers must install fastembed.
    // Variable specifier prevents TS from erroring when fastembed isn't installed.
    const mod = "fastembed";
    const { EmbeddingModel } = (await import(
      mod
    )) as unknown as FastEmbedModule;
    this._inner = new EmbeddingModel({
      model: this.model,
      cacheDir: this.cacheDir,
      showDownloadProgress: this.showDownloadProgress,
    });
    return this._inner;
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const model = await this.getModel();
    const results: number[][] = [];
    for await (const batch of model.embed(texts)) {
      results.push(...batch);
    }
    return results;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.getModel();
      return true;
    } catch {
      return false;
    }
  }
}
