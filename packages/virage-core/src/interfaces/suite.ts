export interface DatabaseSpec {
  /** HTTPS URL to a .tar.gz archive of the LanceDB directory */
  url: string;
  description?: string;
  /** Optional SHA-256 hex digest for integrity verification */
  sha256?: string;
}

export interface EvalVariant {
  /** Unique name for this variant */
  name: string;
  /** Path to the virage config JSON, relative to the suite config file */
  config: string;
  /** Key into the databases map */
  database: string;
  description?: string;
  /** Skip this variant (useful for temporarily disabling without removing) */
  skip?: boolean;
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
}
