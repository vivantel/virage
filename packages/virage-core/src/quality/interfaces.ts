/**
 * Type definitions for the Virage 26-metric quality model.
 * Components 5-8 are optional; they are skipped when the corresponding
 * pipeline feature is disabled in config.
 */

import type {
  HfRagBenchSubset,
  HfRagBenchSummary,
} from "../eval/ragbench-hf.js";
export type { HfRagBenchSubset, HfRagBenchSummary };

// ─── Per-metric result ────────────────────────────────────────────────────────

export interface MetricResult {
  name: string;
  rawValue: number;
  normalizedValue: number;
  weight: number;
  skipped: boolean;
  skipReason?: string;
  mustPass?: boolean;
  mustPassThreshold?: number;
  mustPassPassed?: boolean;
}

// ─── Per-component result ─────────────────────────────────────────────────────

export type ComponentId =
  | "chunking"
  | "metadata"
  | "denseInput"
  | "denseEmbedding"
  | "sparseInput"
  | "lexicalRetrieval"
  | "rerankerInput"
  | "reranker";

export interface ComponentResult {
  id: ComponentId;
  label: string;
  score: number;
  weight: number;
  skipped: boolean;
  skipReason?: string;
  metrics: MetricResult[];
}

// ─── Must-pass gate ───────────────────────────────────────────────────────────

export interface MustPassGate {
  metricName: string;
  threshold: number;
  value: number;
  passed: boolean;
}

// ─── Full quality report ──────────────────────────────────────────────────────

export type QualityStatus = "PASS" | "FAIL";

export interface RagBenchSummary {
  datasetSource: string;
  queriesEvaluated: number;
  topK: number;
  mrrAtK: number;
  ndcgAtK: number;
  recallAtK: number;
  precisionAtK: number;
  hitRateAtK: number;
}

export interface QualityReport {
  timestamp: string;
  overallScore: number;
  status: QualityStatus;
  mustPassGates: MustPassGate[];
  components: ComponentResult[];
  ragBench?: RagBenchSummary;
  ragBenchHf?: HfRagBenchSummary;
  sampleSize: number;
  topK: number;
  configFile: string;
  durationMs: number;
}

// ─── Runner options (mirrors CLI flags) ───────────────────────────────────────

export interface QualityRunnerOptions {
  configFile: string;
  sampleSize: number;
  topK: number;
  failFast: boolean;
  ragBenchPath?: string;
  ragBenchHf?: {
    subsets?: HfRagBenchSubset[];
    maxRowsPerSubset?: number;
    topK?: number;
    hfToken?: string;
  };
  thresholdOverrides?: Partial<Record<string, number>>;
  weightOverrides?: Partial<Record<string, number>>;
}
