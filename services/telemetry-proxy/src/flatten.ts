export interface SessionSummaryPayload {
  session: {
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
    tools_used: string[];
  };
  searches: {
    total: number;
    empty_count: number;
    redundancy_count: number;
    result_count_histogram: Record<string, number>;
  };
  latency: {
    by_phase: Record<string, { p50: number; p95: number; p99: number; count: number }>;
  };
  errors: {
    by_type: Record<string, { count: number; recovered_count: number }>;
  };
  feedback: {
    count: number;
    avg_context_relevance: number | null;
    avg_context_completeness: number | null;
    avg_noise_ratio: number | null;
    missing_category_distribution: Record<string, number>;
  };
  cache: {
    avg_file_hit_rate: number | null;
    avg_semantic_hit_rate: number | null;
  };
}

export function flatten(raw: unknown): Record<string, unknown> {
  const p = raw as SessionSummaryPayload;
  const d: Record<string, unknown> = {};

  // session
  for (const [k, v] of Object.entries(p.session ?? {})) {
    d[`session.${k}`] = v;
  }
  if (Array.isArray(p.session?.tools_used)) {
    d["session.tools_used"] = p.session.tools_used.join(",");
  }

  // searches
  d["searches.total"] = p.searches?.total;
  d["searches.empty_count"] = p.searches?.empty_count;
  d["searches.redundancy_count"] = p.searches?.redundancy_count;
  for (const [bucket, count] of Object.entries(p.searches?.result_count_histogram ?? {})) {
    d[`searches.histogram.${bucket}`] = count;
  }

  // latency
  for (const [phase, stats] of Object.entries(p.latency?.by_phase ?? {})) {
    d[`latency.${phase}.p50`] = stats.p50;
    d[`latency.${phase}.p95`] = stats.p95;
    d[`latency.${phase}.p99`] = stats.p99;
    d[`latency.${phase}.count`] = stats.count;
  }

  // errors
  for (const [type, stats] of Object.entries(p.errors?.by_type ?? {})) {
    d[`errors.${type}.count`] = stats.count;
    d[`errors.${type}.recovered_count`] = stats.recovered_count;
  }

  // feedback
  d["feedback.count"] = p.feedback?.count;
  d["feedback.avg_context_relevance"] = p.feedback?.avg_context_relevance;
  d["feedback.avg_context_completeness"] = p.feedback?.avg_context_completeness;
  d["feedback.avg_noise_ratio"] = p.feedback?.avg_noise_ratio;
  for (const [cat, count] of Object.entries(p.feedback?.missing_category_distribution ?? {})) {
    d[`feedback.missing.${cat}`] = count;
  }

  // cache
  d["cache.avg_file_hit_rate"] = p.cache?.avg_file_hit_rate;
  d["cache.avg_semantic_hit_rate"] = p.cache?.avg_semantic_hit_rate;

  return d;
}
