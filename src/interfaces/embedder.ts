/**
 * Embedding provider interfaces
 */

import { Chunk } from "./chunker.js";

export interface EmbeddingProvider {
  /** Provider name (e.g., 'github-models', 'openai') */
  readonly name: string;

  /** Embedding vector dimensions */
  readonly dimensions: number;

  /** Maximum tokens per request (optional) */
  readonly maxTokens?: number;

  /** Convert text to embedding vector */
  embed(text: string): Promise<number[]>;

  /** Suggested batch size for this provider (used as default when batchSize is not explicitly configured) */
  readonly preferredBatchSize?: number;

  /** Batch convert (optional, for performance) */
  embedBatch?(texts: string[]): Promise<number[][]>;

  /** Stream embeddings one-by-one as they arrive (optional, for large batches) */
  embedStream?(texts: string[]): AsyncIterable<number[]>;

  /** Check if provider is available (e.g., valid API key) */
  healthCheck?(): Promise<boolean>;
}

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  batchSize?: number;
  rateLimitMs?: number;
}

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
  embeddedAt: number;
}
