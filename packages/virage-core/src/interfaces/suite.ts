export interface FilesetDefinition {
  /** Glob patterns to include */
  include: string[];
  /** Glob patterns to exclude within this fileset (becomes ignorePatterns in virage config) */
  exclude?: string[];
}

export interface DatabaseSpec {
  /** HTTPS URL to a .tar.gz archive of the LanceDB directory */
  url: string;
  description?: string;
  /** SHA-256 hex digest for integrity verification */
  sha256?: string;
  /** Embedder package and options used when building this database */
  embedder?: { package: string; options?: Record<string, unknown> };
  /** Vector store package and options used when building this database */
  vectorStore?: { package: string; options?: Record<string, unknown> };
  /** Per-fileset chunker strategy overrides (partial, merges with suite.chunkers) */
  chunkers?: Record<string, string>;
  /** Plugin versions captured at build time for cache-key stability */
  pluginVersions?: Record<string, string>;
}

export interface EvalVariant {
  /** Unique name for this variant */
  name: string;
  /**
   * Path to a virage config JSON, relative to the suite config file.
   * When absent the variant config is generated from suite filesets + database spec.
   */
  config?: string;
  /** Key into the databases map */
  database: string;
  description?: string;
  /** Skip this variant (useful for temporarily disabling without removing) */
  skip?: boolean;
  /**
   * Virage search config block (hybrid, reranker, etc.) for this variant.
   * Absent = pure vector search, no reranker.
   */
  search?: Record<string, unknown>;
}

export interface EvalSuite {
  version: "1";
  /** Path to the EvalDataset JSON, relative to the suite config file */
  dataset: string;
  /** top-K results to retrieve per query (default: 10) */
  topK?: number;
  /** Name of the variant that acts as the baseline for all comparisons */
  baseline: string;
  /** CI quality gate — suite exits 1 if baseline MRR falls below this */
  ciGate?: { mrr: number };
  /** Named database archives keyed by ID */
  databases: Record<string, DatabaseSpec>;
  /** Variants to evaluate */
  variants: EvalVariant[];
  /**
   * Local directory for caching downloaded archives.
   * Relative to the suite config file. Default: .virage/eval-cache
   */
  cacheDir?: string;
  /**
   * Named file pattern sets — immutable, shared by all databases.
   * Keys are referenced by suite.chunkers and DatabaseSpec.chunkers.
   */
  filesets?: Record<string, FilesetDefinition>;
  /**
   * Default fileset → chunker strategy mapping.
   * DatabaseSpec.chunkers can override individual entries.
   */
  chunkers?: Record<string, string>;
  /**
   * Global virage chunking.ignore patterns applied before any chunker runs
   * (binary files, lock files, generated files).
   */
  exclude?: string[];
}
