/**
 * Vector store interfaces
 */

import type { IndexStats, QueryPerfReport } from "./quality.js";

export interface VectorStoreMeta {
  providerName: string;
  model?: string;
  dimensions: number;
  distanceMetric?: string;
  createdAt: number;
}

export interface VectorDocument {
  /** Unique ID (optional; set to denseTextHash by Uploader when omitted). */
  id?: string;

  /** Text sent to the embedding model (breadcrumb + full body). */
  denseText: string;

  /** Raw body used for BM25/FTS lexical search (no breadcrumb prefix). */
  sparseText: string;

  /** sha256(denseText) truncated to 16 hex chars — primary dedup key. */
  denseTextHash: string;

  /** Method fingerprint for sparseText generation (ADR-037). */
  sparseTextGeneratorId: string;

  /** Method fingerprint for metadata assembly (ADR-037). */
  metadataGeneratorId: string;

  /** Metadata for filtering (serialized ChunkMeta). */
  metadata: Record<string, unknown>;

  /** Dense embedding vector of denseText. */
  denseVector: number[];

  /** Source file path (for tracking updates). */
  sourceFile: string;

  /** Git commit hash (for change detection). */
  commitHash: string;

  /** Collection name (for multi-collection stores). */
  collection?: string;
}

/** A stored document returned by listAll — denseVector is omitted by default for efficiency. */
export interface ListedDocument {
  id: string;
  denseText: string;
  sparseText: string;
  denseTextHash: string;
  sparseTextGeneratorId: string;
  metadataGeneratorId: string;
  metadata: Record<string, unknown>;
  sourceFile: string;
  commitHash: string;
  /** Included only when listAll is called with includeVectors: true. */
  denseVector?: number[];
}

export interface VectorSearchResult {
  id: string;
  /** Text used for dense embedding — also input to the cross-encoder reranker. */
  denseText: string;
  /** Raw body text used for BM25 search. */
  sparseText: string;
  metadata: Record<string, unknown>;
  similarity: number;
  sourceFile?: string;
  /** UTC timestamp when this chunk was indexed — used for recency-weighted scoring. */
  ingestedAt?: Date;
  /** Method fingerprint for sparseText generation (ADR-037). */
  sparseTextGeneratorId?: string;
  /** Method fingerprint for metadata assembly (ADR-037). */
  metadataGeneratorId?: string;
}

/** Options controlling composite similarity + recency scoring. */
export interface SearchOptions {
  /** Weight applied to vector similarity (0–1). Defaults to 0.85. */
  alpha?: number;
  /** Weight applied to recency score (0–1). Defaults to 0.15. Only applied when ingestedAt is available. */
  beta?: number;
  /** Metadata key-value pairs to filter results (e.g. `{ branch: "main" }`). Applied as post-filter. */
  filter?: Record<string, unknown>;
  /** Enable BM25 + vector hybrid search with Reciprocal Rank Fusion. Requires queryText. Default: false. */
  hybrid?: boolean;
  /** Blend weight for hybrid search: 0 = pure BM25, 1 = pure vector. Default: 0.6. */
  hybridAlpha?: number;
  /** Original query text, required for the BM25 side of hybrid search. */
  queryText?: string;
}

export interface VectorStore {
  /** Store name */
  readonly name: string;

  /** Initialize store (create tables, indexes, etc.) */
  initialize(): Promise<void>;

  /** Insert or update documents */
  upsert(documents: VectorDocument[]): Promise<void>;

  /** Delete documents by source file */
  deleteBySourceFile(sourceFiles: string[]): Promise<void>;

  /** Get current state (sourceFile → commitHash) for change detection */
  getCurrentState(collection?: string): Promise<Map<string, string>>;

  /** Search by embedding vector */
  search(
    queryEmbedding: number[],
    topK: number,
    collection?: string,
    options?: SearchOptions,
  ): Promise<VectorSearchResult[]>;

  /** Batch delete by document IDs (more efficient than per-file delete when IDs are known) */
  batchDelete?(ids: string[]): Promise<void>;

  /** Optional: delete entire collection */
  deleteCollection?(collection: string): Promise<void>;

  /** Optional: get store statistics */
  getStats?(): Promise<{ documentCount: number; collections: string[] }>;

  /** Optional: get vector index quality metrics */
  getIndexStats?(): Promise<IndexStats>;

  /** Optional: get query performance report */
  getQueryPerfReport?(timeframeHours: number): Promise<QueryPerfReport>;

  /** Optional: read embedder metadata stored alongside the index */
  readMeta?(): Promise<VectorStoreMeta | null>;

  /** Optional: write embedder metadata alongside the index */
  writeMeta?(meta: VectorStoreMeta): Promise<void>;

  /** Optional: list all stored documents (without vectors by default for efficiency) */
  listAll?(opts?: {
    limit?: number;
    offset?: number;
    includeVectors?: boolean;
  }): Promise<ListedDocument[]>;

  /** Optional: close/disconnect from the store (important for file-backed stores like LanceDB) */
  close?(): Promise<void>;
}

export interface VectorStoreConfig {
  provider: VectorStore;
  collection?: string;
}
