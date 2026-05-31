/**
 * Vector store interfaces
 */

export interface VectorDocument {
  /** Unique ID (optional, auto-generated if not provided) */
  id?: string;

  /** Original text content */
  content: string;

  /** Metadata for filtering */
  metadata: Record<string, unknown>;

  /** Embedding vector */
  embedding: number[];

  /** Source file path (for tracking updates) */
  sourceFile: string;

  /** Git commit hash (for change detection) */
  commitHash: string;

  /** Content hash (for change detection) */
  contentHash: string;

  /** Collection name (for multi-collection stores) */
  collection?: string;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
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
  ): Promise<VectorSearchResult[]>;

  /** Optional: delete entire collection */
  deleteCollection?(collection: string): Promise<void>;

  /** Optional: get store statistics */
  getStats?(): Promise<{ documentCount: number; collections: string[] }>;
}

export interface VectorStoreConfig {
  provider: VectorStore;
  collection?: string;
}
