import type {
  EmbeddingProvider,
  EmbeddingMetrics,
  Logger,
} from "@vivantel/rag-core";
import OpenAI from "openai";
import { computeEmbeddingMetrics } from "./embedding-metrics.js";
import { SemanticCache, type SemanticCacheConfig } from "./semantic-cache.js";

export interface OpenAICompatibleEmbedderOptions {
  apiKey: string;
  model: string;
  dimensions?: number;
  /** Defaults to https://api.openai.com/v1 */
  baseURL?: string;
  organizationId?: string;
  maxRetries?: number;
  /** Optional semantic or exact embedding cache. */
  cache?: SemanticCacheConfig;
}

export class OpenAICompatibleEmbedder implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  readonly model: string;
  readonly preferredBatchSize = 100;

  private readonly client: OpenAI;
  private readonly cache: SemanticCache | null;
  private readonly baseURL: string | undefined;
  private logger: Logger | null = null;

  constructor(options: OpenAICompatibleEmbedderOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions ?? 1536;
    this.baseURL = options.baseURL;
    this.name = options.baseURL
      ? `openai-compatible:${new URL(options.baseURL).hostname}`
      : "openai";

    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      organization: options.organizationId,
      maxRetries: options.maxRetries ?? 3,
    });

    this.cache = options.cache ? new SemanticCache(options.cache) : null;
  }

  setLogger(logger: Logger): void {
    this.logger = logger.withTag("openai");
  }

  async embed(text: string): Promise<number[]> {
    if (this.cache) {
      const hit = await this.cache.get(text, (t) => this.embedDirect(t));
      if (hit) return hit;
    }
    const embedding = await this.embedDirect(text);
    if (this.cache) await this.cache.set(text, embedding);
    return embedding;
  }

  private async embedDirect(text: string): Promise<number[]> {
    const start = Date.now();
    const res = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions !== 1536 ? this.dimensions : undefined,
    });
    this.logger?.debug(
      `Embed call: ${Date.now() - start}ms, ${text.length} chars`,
    );
    return res.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    this.logger?.verbose(
      `Batch ${texts.length} texts to ${this.baseURL ?? "https://api.openai.com/v1"}`,
    );
    this.logger?.trace(
      `Text lengths: ${texts.map((t) => t.length).join(", ")}`,
    );

    if (this.cache) {
      // Try cache for each text; fall back to batch API for misses
      const results: (number[] | null)[] = await Promise.all(
        texts.map((t) => this.cache!.get(t, (x) => this.embedDirect(x))),
      );
      const missIndices = results
        .map((r, i) => (r === null ? i : -1))
        .filter((i) => i >= 0);

      if (missIndices.length === 0) return results as number[][];

      const missTexts = missIndices.map((i) => texts[i]);
      const missEmbeddings = await this.embedBatchDirect(missTexts);
      for (let k = 0; k < missIndices.length; k++) {
        results[missIndices[k]] = missEmbeddings[k];
        await this.cache!.set(missTexts[k], missEmbeddings[k]);
      }
      return results as number[][];
    }
    return this.embedBatchDirect(texts);
  }

  private async embedBatchDirect(texts: string[]): Promise<number[][]> {
    const start = Date.now();
    const res = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimensions !== 1536 ? this.dimensions : undefined,
    });
    this.logger?.debug(
      `Batch call: ${Date.now() - start}ms, ${texts.length} texts`,
    );
    return res.data.map((d: { embedding: number[] }) => d.embedding);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.embed("health check");
      return true;
    } catch {
      return false;
    }
  }

  async getMetrics(embeddings: number[][]): Promise<EmbeddingMetrics> {
    return computeEmbeddingMetrics(embeddings);
  }
}
