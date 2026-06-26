import type { ChunkMeta } from "./artifact.js";

export interface Chunk {
  /** Breadcrumb prefix + full chunk body — text sent to the embedding model. */
  denseText: string;

  /** Raw chunk body without breadcrumb — used for BM25/FTS lexical search. */
  sparseText: string;

  /** sha256(denseText) truncated to 16 hex chars — primary cache key. */
  denseTextHash: string;

  /**
   * Method fingerprint for sparseText generation (`${name}@${version}:sparse:${optsFp}`).
   * Stored per-chunk. If changed on a subsequent run, sparseText is regenerated
   * and the FTS index is rebuilt for the affected fileset.
   */
  sparseTextGeneratorId: string;

  /**
   * Method fingerprint for metadata assembly (`${name}@${version}:meta:${optsFp}`).
   * Stored per-chunk. If changed on a subsequent run, metadata is re-enriched
   * for the affected fileset.
   */
  metadataGeneratorId: string;

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

  /** Semver version — used to compute generator IDs. */
  version: string;

  /** Glob patterns this chunker handles. */
  patterns: string[];

  /**
   * Method fingerprint for sparseText generation for this instance.
   * Computed from name + version + sparse-generation options.
   * Stored per-chunk; if changed from a previous run, FTS rebuild is triggered
   * for chunks produced by this chunker.
   */
  sparseTextGeneratorId: string;

  /**
   * Method fingerprint for metadata assembly for this instance.
   * Computed from name + version + metadata-assembly options.
   * Stored per-chunk; if changed from a previous run, metadata re-enrichment
   * is triggered for chunks produced by this chunker.
   */
  metadataGeneratorId: string;

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

/**
 * Wraps a FileChunker with optional pipeline-level path filters.
 * `include` and `ignore` are applied by virage-core before routing any file
 * to the chunker; they are independent of the package's built-in `patterns`.
 */
export interface ChunkerEntry {
  chunker: FileChunker;
  /** If set, only files matching at least one of these globs are sent to this chunker. */
  include?: string[];
  /** If set, files matching any of these globs are skipped for this chunker. */
  ignore?: string[];
}

export interface ChunkTransformer {
  /** Transformer name */
  name: string;

  /** Transform a chunk (return null to drop it) */
  transform(chunk: Chunk): Promise<Chunk | null>;
}
