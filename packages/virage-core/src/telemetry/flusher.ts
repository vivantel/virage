import type { VirageDb } from "../core/virage-db.js";
import type {
  TelemetryConfig,
  TelemetrySearchRow,
  TelemetryLatencyRow,
  TelemetryErrorRow,
  TelemetryFeedbackRow,
  TelemetryCacheStatsRow,
} from "./types.js";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(p * sorted.length), sorted.length - 1);
  return sorted[idx];
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

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
    by_phase: Record<
      string,
      { p50: number; p95: number; p99: number; count: number }
    >;
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

export class TelemetryFlusher {
  constructor(
    private readonly db: VirageDb,
    private readonly config: TelemetryConfig,
  ) {}

  buildSessionSummaryPayload(sessionId: string): SessionSummaryPayload | null {
    const session = this.db.getTelemetrySession(sessionId);
    if (!session) return null;

    const searches: TelemetrySearchRow[] =
      this.db.getSearchesForSession(sessionId);
    const latencies: TelemetryLatencyRow[] =
      this.db.getLatencyForSession(sessionId);
    const errors: TelemetryErrorRow[] = this.db.getErrorsForSession(sessionId);
    const feedbacks: TelemetryFeedbackRow[] =
      this.db.getFeedbackForSession(sessionId);
    const cacheStats: TelemetryCacheStatsRow[] =
      this.db.getCacheStatsForSession(sessionId);

    // Searches
    const emptyCount = searches.filter((s) => s.empty === 1).length;
    const redundancyCount = searches.filter(
      (s) => s.redundancy_detected === 1,
    ).length;
    const histogram: Record<string, number> = {};
    for (const s of searches) {
      histogram[s.result_count_bucket] =
        (histogram[s.result_count_bucket] ?? 0) + 1;
    }

    // Latency by phase
    const byPhase: Record<string, number[]> = {};
    for (const l of latencies) {
      (byPhase[l.phase] ??= []).push(l.duration_ms);
    }
    const latencyByPhase: Record<
      string,
      { p50: number; p95: number; p99: number; count: number }
    > = {};
    for (const [phase, durations] of Object.entries(byPhase)) {
      const sorted = [...durations].sort((a, b) => a - b);
      latencyByPhase[phase] = {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        count: sorted.length,
      };
    }

    // Errors by type
    const byType: Record<string, { count: number; recovered_count: number }> =
      {};
    for (const e of errors) {
      const entry = byType[e.error_type] ?? {
        count: 0,
        recovered_count: 0,
      };
      entry.count++;
      if (e.recovered === 1) entry.recovered_count++;
      byType[e.error_type] = entry;
    }

    // Feedback
    const relevanceVals = feedbacks
      .map((f) => f.context_relevance)
      .filter((v): v is number => v != null);
    const completenessVals = feedbacks
      .map((f) => f.context_completeness)
      .filter((v): v is number => v != null);
    const noiseVals = feedbacks
      .map((f) => f.noise_ratio)
      .filter((v): v is number => v != null);
    const missingCatDist: Record<string, number> = {};
    for (const f of feedbacks) {
      if (f.missing_category) {
        missingCatDist[f.missing_category] =
          (missingCatDist[f.missing_category] ?? 0) + 1;
      }
    }

    // Cache
    const fileHits = cacheStats
      .map((c) => c.file_hit_rate)
      .filter((v): v is number => v != null);
    const semanticHits = cacheStats
      .map((c) => c.semantic_hit_rate)
      .filter((v): v is number => v != null);

    return {
      session: {
        id: session.id,
        started_at: session.started_at,
        ended_at: session.ended_at,
        embedding_model: session.embedding_model,
        chunking_strategy: session.chunking_strategy,
        store_type: session.store_type,
        node_version: session.node_version,
        os: session.os,
        total_searches: session.total_searches,
        total_tool_calls: session.total_tool_calls,
        tools_used: JSON.parse(session.tools_used_json) as string[],
      },
      searches: {
        total: searches.length,
        empty_count: emptyCount,
        redundancy_count: redundancyCount,
        result_count_histogram: histogram,
      },
      latency: { by_phase: latencyByPhase },
      errors: { by_type: byType },
      feedback: {
        count: feedbacks.length,
        avg_context_relevance:
          relevanceVals.length > 0 ? avg(relevanceVals) : null,
        avg_context_completeness:
          completenessVals.length > 0 ? avg(completenessVals) : null,
        avg_noise_ratio: noiseVals.length > 0 ? avg(noiseVals) : null,
        missing_category_distribution: missingCatDist,
      },
      cache: {
        avg_file_hit_rate: fileHits.length > 0 ? avg(fileHits) : null,
        avg_semantic_hit_rate:
          semanticHits.length > 0 ? avg(semanticHits) : null,
      },
    };
  }

  async flush(sessionId: string): Promise<boolean> {
    if (!this.config.enabled || !this.config.endpoint) return false;
    const payload = this.buildSessionSummaryPayload(sessionId);
    if (!payload) return false;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.config.api_key) {
        headers["Authorization"] = `Bearer ${this.config.api_key}`;
      }
      const res = await fetch(this.config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        this.db.markTelemetryFlushed(sessionId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async retryPending(): Promise<void> {
    if (!this.config.enabled || !this.config.endpoint) return;
    const maxAgeMs = this.config.privacy.max_retry_hours * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const unflushed = this.db
      .getUnflushedSessions()
      .filter((s) => s.started_at >= cutoff);
    for (const session of unflushed) {
      await this.flush(session.id);
    }
  }

  startPeriodicFlush(
    sessionId: string,
    intervalMs = 60 * 60 * 1000,
  ): () => void {
    const id = setInterval(() => {
      void this.flush(sessionId);
    }, intervalMs);
    return () => clearInterval(id);
  }
}
