/**
 * ChunkMeta — full enrichment metadata carried by every chunk.
 * Covers provenance, hierarchy, code-specific, spreadsheet-specific,
 * and downstream enrichment fields.
 */
export interface ChunkMeta {
  // Provenance
  sourceFile: string;
  sourceFormat: string;
  chunkIndex: number;
  totalChunks: number;
  strategy: string;
  estimatedTokens: number;
  fileHash?: string;
  fileModifiedAt?: string;
  fileSizeBytes?: number;

  // Byte / line / page offsets
  byteStart: number;
  byteEnd: number;
  lineStart?: number;
  lineEnd?: number;
  pageStart?: number;
  pageEnd?: number;

  // Language
  lang?: string;
  codeLanguage?: string;

  // Hierarchy / document structure
  breadcrumb: string[];
  sectionTitle?: string;
  headingLevel?: number;
  documentOutline?: string[];

  // Hierarchy links — used for on-the-fly contextText assembly at query time (ADR-036)
  /** denseTextHash of the logical parent section chunk. */
  parentId?: string;
  /** denseTextHashes of adjacent chunks [prev, next] for context assembly. */
  siblingIds?: string[];
  /** denseTextHash of the immediately preceding chunk (same section). */
  siblingPrev?: string;
  /** denseTextHash of the immediately following chunk (same section). */
  siblingNext?: string;

  // Code-specific enrichment
  fqn?: string;
  imports?: string[];
  inheritanceChain?: string[];

  // Spreadsheet-specific enrichment
  sheetName?: string;
  columnHeaders?: string[];
  cellReference?: string;
  formulaDependencies?: string[];

  // Quality / truncation
  qualityScore?: number;
  truncated?: boolean;

  // Labels — applied at index time by the label pipeline (path rules, CODEOWNERS, .virage-labels.json)
  labels?: string[];

  // Downstream enrichment (Phase 5+)
  keywords?: string[];
  summary?: string;
  nerEntities?: Array<{ text: string; label: string }>;
}
