import type { EmbeddingProvider } from "@vivantel/rag-core";
import OpenAI from "openai";

export interface OpenAICompatibleEmbedderOptions {
  apiKey: string;
  model: string;
  dimensions?: number;
  /** Defaults to https://api.openai.com/v1 */
  baseURL?: string;
  organizationId?: string;
  maxRetries?: number;
}

export class OpenAICompatibleEmbedder implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  readonly model: string;
  readonly preferredBatchSize = 100;

  private readonly client: OpenAI;

  constructor(options: OpenAICompatibleEmbedderOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions ?? 1536;
    this.name = options.baseURL
      ? `openai-compatible:${new URL(options.baseURL).hostname}`
      : "openai";

    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      organization: options.organizationId,
      maxRetries: options.maxRetries ?? 3,
    });
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions !== 1536 ? this.dimensions : undefined,
    });
    return res.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimensions !== 1536 ? this.dimensions : undefined,
    });
    return res.data.map((d) => d.embedding);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.embed("health check");
      return true;
    } catch {
      return false;
    }
  }
}
