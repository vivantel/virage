/**
 * Embedding provider interfaces
 */

import type { EmbeddingMetrics } from "./quality.js";

export interface EmbeddingProvider {
  /** Provider name (e.g., 'github-models', 'openai') */
  readonly name: string;

  /** Embedding vector dimensions */
  readonly dimensions: number;

  /**
   * The specific model identifier (e.g., 'text-embedding-3-small', 'BAAI/bge-small-en-v1.5').
   * Used for cache invalidation: changing the model always triggers a full re-embed,
   * regardless of provider name. Same model via different providers (OpenAI vs Azure vs GitHub Models)
   * produces identical vectors — no invalidation in that case.
   */
  readonly model?: string;

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

  /** Compute quality metrics for an already-generated set of embeddings */
  getMetrics?(embeddings: number[][]): Promise<EmbeddingMetrics>;

  /**
   * Pre-load the model before the main pipeline loop begins.
   * Implement this on local/ONNX-based providers to surface loading progress.
   * API-backed providers can omit it — the first embed() call is already fast.
   */
  preWarm?(onProgress?: (loaded: number, total: number) => void): Promise<void>;
}

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  batchSize?: number;
  rateLimitMs?: number;
}

/** Metadata stored in the embeddings SQLite DB to detect model/store changes across runs. */
export interface EmbeddingsMeta {
  schemaVersion: number;
  /** Informational only — not used for mismatch detection. */
  providerName: string;
  /** Discriminator: if dimensions change, all embeddings are invalid. */
  providerDimensions: number;
  /** Discriminator: if model changes, all embeddings are invalid. */
  model?: string;
  /** Name of the vector store last written to. If changed, triggers a force re-upload. */
  vectorStoreName?: string;
  createdAt: number;
  updatedAt: number;
}
