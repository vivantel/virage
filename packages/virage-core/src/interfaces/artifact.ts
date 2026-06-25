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

  // Sibling links (IDs of adjacent chunks in sequence)
  siblingPrev?: string;
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

  // Downstream enrichment (Phase 5+)
  keywords?: string[];
  summary?: string;
  nerEntities?: Array<{ text: string; label: string }>;
}
