// ViDoc AST types.
// These mirror the Rust structs in crates/virage-vidoc/src/lib.rs.
// TODO(phase-1): move to @vivantel/virage-core once the core PR lands.

export type DocNodeType =
  | "document"
  | "section"
  | "heading"
  | "paragraph"
  | "table"
  | "table-row"
  | "table-cell"
  | "list"
  | "list-item"
  | "code"
  | "formula"
  | "image"
  | "link"
  | "footnote"
  | "caption"
  | "abstract"
  | "metadata";

export interface DocNodeAttrs {
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  role?: "caption" | "footnote" | "abstract" | "toc-entry" | "header" | "footer";
  breadcrumb?: string[];
  byteStart: number;
  byteEnd: number;
  lineStart?: number;
  lineEnd?: number;
  pageNumber?: number;
  lang?: string;
  codeLanguage?: string;
  tableRow?: number;
  tableCol?: number;
  isHeader?: boolean;
  listDepth?: number;
  ordered?: boolean;
  sourceFormat?: string;
}

export interface DocNode {
  type: DocNodeType;
  children?: DocNode[];
  text?: string;
  attrs: DocNodeAttrs;
}

// ── Metadata types ────────────────────────────────────────────────────────────

/**
 * Filterable metadata stored alongside the Search Representation in the vector
 * index. Contains only fields that are useful for pre-retrieval filtering.
 */
export interface FilterMeta {
  sourceFile: string;
  sourceFormat: string;
  breadcrumb: string[];
  byteStart: number;
  byteEnd: number;
  lineStart?: number;
  lineEnd?: number;
  pageStart?: number;
  pageEnd?: number;
  lang?: string;
  codeLanguage?: string;
  chunkIndex: number;
  totalChunks: number;
  strategy: string;
  estimatedTokens: number;
  fileHash?: string;
  fileModifiedAt?: string;
  fileSizeBytes?: number;
}

/**
 * Full enrichment payload carried by ArtifactSet.metadata. A superset of
 * FilterMeta that includes hierarchy details, sibling/parent links, and
 * format-specific fields used during cross-encoder re-ranking.
 *
 * parentId and siblingIds are used for on-the-fly contextText assembly at
 * query time (Level 5, Step 3) — see ARCHITECTURE.md.
 */
export interface ChunkMeta extends FilterMeta {
  sectionTitle?: string;
  headingLevel?: number;
  documentOutline?: string[];

  /** denseTextHash of the logical parent section chunk. Used for context assembly at query time. */
  parentId?: string;
  /** denseTextHashes of adjacent chunks (prev, next). Used for context assembly at query time. */
  siblingIds?: string[];
  /** denseTextHash of the immediately preceding chunk (same section). */
  siblingPrev?: string;
  /** denseTextHash of the immediately following chunk (same section). */
  siblingNext?: string;

  qualityScore?: number;
  truncated?: boolean;

  // Code-specific enrichment
  fqn?: string;
  imports?: string[];
  inheritanceChain?: string[];

  // Spreadsheet-specific enrichment
  sheetName?: string;
  columnHeaders?: string[];
  cellReference?: string;
  formulaDependencies?: string[];

  // Post-processing hooks (populated downstream by enrichment pipeline, not by chunker)
  keywords?: string[];
  summary?: string;
  nerEntities?: Array<{ text: string; label: string }>;
}

// ── Flat artifact model (Level 0) ─────────────────────────────────────────────

/**
 * The atomic unit produced by walkToChunks — one per logical segment.
 *
 * Structurally equivalent to Chunk in virage-core. Three text fields are stored
 * at index time; contextText is assembled on-the-fly at query time from
 * denseText, metadata.parentId, and metadata.siblingIds.
 *
 * sparseTextGeneratorId and metadataGeneratorId are per-chunk method fingerprints
 * (not content fingerprints). They change when the chunker configuration changes,
 * enabling incremental rebuilding of only the affected artifacts.
 */
export interface ArtifactSet {
  /** Breadcrumb prefix + full window body — text sent to the embedding model. */
  denseText: string;

  /** Raw body without breadcrumb — used for BM25 / FTS lexical search. */
  sparseText: string;

  /** sha256(denseText).slice(0,16) — 16-char hex content fingerprint and primary cache key. */
  denseTextHash: string;

  /** Method fingerprint for sparseText generation. Triggers FTS rebuild when changed. */
  sparseTextGeneratorId: string;

  /** Method fingerprint for metadata assembly. Triggers metadata re-enrichment when changed. */
  metadataGeneratorId: string;

  /** Full enrichment metadata. */
  metadata: ChunkMeta;

  /** Original source file path. */
  sourceFile: string;

  /** Git commit hash when this chunk was generated. */
  commitHash: string;
}

/**
 * The plugin interface — structurally compatible with FileChunker from virage-core.
 *
 * sparseTextGeneratorId and metadataGeneratorId are computed once per chunker
 * instance from name + version + configuration fingerprint.
 */
export interface ArtifactChunker {
  name: string;
  version: string;
  patterns: string[];
  sparseTextGeneratorId: string;
  metadataGeneratorId: string;
  chunk(filePath: string, commitHash: string): Promise<ArtifactSet[]>;
  canProcess?(filePath: string): Promise<boolean>;
}
