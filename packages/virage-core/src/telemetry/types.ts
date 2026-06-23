export interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string;
  api_key?: string;
  tiers: {
    implicit: boolean;
    explicit_feedback: {
      enabled: boolean;
      sampling_rate: number;
      always_on_anomaly: boolean;
      max_token_budget_percent: number;
    };
  };
  privacy: {
    query_hashing: boolean;
    file_path_anonymization: boolean;
    aggregation_window_minutes: number;
    max_local_buffer_mb: number;
    max_retry_hours: number;
  };
}

export const COMMUNITY_TELEMETRY_ENDPOINT =
  "https://telemetry.virage.vivantel.dev/ingest";

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: true,
  endpoint: COMMUNITY_TELEMETRY_ENDPOINT,
  tiers: {
    implicit: true,
    explicit_feedback: {
      enabled: false,
      sampling_rate: 0.2,
      always_on_anomaly: true,
      max_token_budget_percent: 3,
    },
  },
  privacy: {
    query_hashing: true,
    file_path_anonymization: true,
    aggregation_window_minutes: 60,
    max_local_buffer_mb: 10,
    max_retry_hours: 48,
  },
};

export interface SessionMetadata {
  embeddingModel?: string;
  chunkingStrategy?: string;
  storeType?: string;
  nodeVersion: string;
  os: string;
}

export interface TelemetrySessionRow {
  id: string;
  started_at: string;
  ended_at?: string;
  embedding_model?: string;
  chunking_strategy?: string;
  store_type?: string;
  node_version: string;
  os: string;
  total_searches: number;
  total_tool_calls: number;
  tools_used_json: string;
  flushed: number;
}

export interface TelemetrySearchRow {
  id: string;
  session_id: string;
  occurred_at: string;
  result_count: number;
  result_count_bucket: string;
  empty: number;
  query_hash?: string;
  redundancy_detected: number;
  flushed: number;
}

export interface TelemetryLatencyRow {
  id?: number;
  session_id: string;
  occurred_at: string;
  phase: string;
  duration_ms: number;
  flushed: number;
}

export interface TelemetryErrorRow {
  id?: number;
  session_id: string;
  occurred_at: string;
  error_type: string;
  retry_count: number;
  recovered: number;
  flushed: number;
}

export interface TelemetryFeedbackRow {
  id?: number;
  session_id: string;
  search_id: string;
  occurred_at: string;
  was_useful: number;
  context_relevance?: number;
  context_completeness?: number;
  noise_ratio?: number;
  missing_category?: string;
  flushed: number;
}

export interface TelemetryCacheStatsRow {
  id?: number;
  session_id: string;
  recorded_at: string;
  file_hit_rate?: number;
  semantic_hit_rate?: number;
  flushed: number;
}

export type ResultCountBucket = "0" | "1-3" | "4-10" | "11-20" | "20+";

export function resultCountBucket(n: number): ResultCountBucket {
  if (n === 0) return "0";
  if (n <= 3) return "1-3";
  if (n <= 10) return "4-10";
  if (n <= 20) return "11-20";
  return "20+";
}

export const MISSING_CATEGORY_VALUES = [
  "missing_error_handling",
  "missing_config_example",
  "missing_api_reference",
  "missing_type_signature",
  "missing_test_coverage",
  "other",
] as const;

export type MissingCategory = (typeof MISSING_CATEGORY_VALUES)[number];

export function normalizeMissingCategory(
  value: string | undefined,
): MissingCategory | undefined {
  if (!value) return undefined;
  return (MISSING_CATEGORY_VALUES as readonly string[]).includes(value)
    ? (value as MissingCategory)
    : "other";
}
