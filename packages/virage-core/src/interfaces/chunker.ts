import type { ChunkMeta } from "./artifact.js";

export interface Chunk {
  /** Breadcrumb prefix + full chunk body — text sent to the embedding model. */
  denseText: string;

  /** Raw chunk body without breadcrumb — used for BM25/FTS lexical search. */
  sparseText: string;

  /** Full LLM context: body + boundary padding + injected code declarations. */
  contextText: string;

  /** sha256(denseText) truncated to 16 hex chars — primary cache key. */
  denseTextHash: string;

  /** Enrichment metadata. */
  metadata: ChunkMeta;

  /** Original source file path. */
  sourceFile: string;

  /** Git commit hash when this chunk was generated. */
  commitHash: string;
}

export interface EmbeddedChunk extends Chunk {
  /** Dense embedding vector of denseText. */
  denseVector: number[];

  /** Unix timestamp (ms) when embedding was computed. */
  embeddedAt: number;
}

export interface FileChunker {
  /** Unique name of this chunker plugin. */
  name: string;

  /** Semver version — used to build sparseTextId / contextTextHash. */
  version: string;

  /** Glob patterns this chunker handles. */
  patterns: string[];

  /**
   * Stable fingerprint of the SparseText generation parameters for this
   * instance (e.g. sha256 of package name + version + sparse options).
   * The same value for every chunk produced in a session.
   * Stored in the meta table; if unchanged from last run, FTS rebuild is skipped.
   */
  sparseTextId: string;

  /**
   * Stable fingerprint of the ContextText generation parameters for this
   * instance. Stored in the meta table; if unchanged, contextText refresh
   * is skipped.
   */
  contextTextHash: string;

  /**
   * Process a file and return chunks.
   * Returns an empty array if the file should be skipped.
   */
  chunk(filePath: string, commitHash: string): Promise<Chunk[]>;

  /**
   * Optional: validate whether this chunker can process the file
   * (called before chunk() to filter early).
   */
  canProcess?(filePath: string): Promise<boolean>;
}

export interface ChunkTransformer {
  /** Transformer name */
  name: string;

  /** Transform a chunk (return null to drop it) */
  transform(chunk: Chunk): Promise<Chunk | null>;
}
