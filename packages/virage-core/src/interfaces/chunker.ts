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
 * A path-glob → tag mapping rule applied at index time within a fileSet (ADR-043, ADR-046).
 * Files matching `match` (minimatch glob, relative to source root) get `add` appended
 * to their `ChunkMeta.tags`.
 */
export interface TagRule {
  /** Minimatch glob pattern (relative to source root, e.g. "src/payments/**"). */
  match: string;
  /** Tags to add when the pattern matches (e.g. ["team:payments", "pci-scope"]). */
  add: string[];
}

/** Template value: inline minijinja string or a path to a .jinja file (ADR-045). */
export type TemplateValue = string | { file: string };

/** Per-chunker output templates applied post-chunking, pre-embedding (ADR-045). */
export interface ChunkerTemplate {
  /** minijinja template replacing denseText. No-op until virage-renderer-minijinja ships. */
  denseText?: TemplateValue;
  /** minijinja template replacing sparseText. No-op until virage-renderer-minijinja ships. */
  sparseText?: TemplateValue;
}

/**
 * Wraps a FileChunker with fileSet-level metadata and pipeline-level path filters.
 * One ChunkerEntry is created per (fileSet × chunkerConfig) pair during config load.
 * `include` and `ignore` are the fileSet's patterns; they are applied by the GitTracker
 * and ChunkProcessor before routing files to the chunker.
 * `fileSetTags` and `tagRules` drive the tag pipeline (ADR-043, ADR-046).
 */
export interface ChunkerEntry {
  chunker: FileChunker;
  /** If set, only files matching at least one of these globs are sent to this chunker. */
  include?: string[];
  /** If set, files matching any of these globs are skipped for this chunker. */
  ignore?: string[];
  /** Pre-computed from fileSet.tags — injected into every chunk from this fileSet. */
  fileSetTags: string[];
  /** fileSet.tagRules — applied per-file based on minimatch glob matching. */
  tagRules: TagRule[];
  /** The npm package name of the chunker — stored as ChunkMeta.chunkerKey (ADR-044). */
  chunkerKey: string;
  /** Per-chunker output templates (ADR-045). No-op until renderer ships. */
  templates?: ChunkerTemplate;
  /** Name of the fileSet this entry belongs to. */
  fileSetName: string;
}

export interface ChunkTransformer {
  /** Transformer name */
  name: string;

  /** Transform a chunk (return null to drop it) */
  transform(chunk: Chunk): Promise<Chunk | null>;
}
