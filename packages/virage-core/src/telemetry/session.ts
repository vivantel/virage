import { createHash } from "crypto";
import type { VirageDb } from "../core/virage-db.js";
import {
  type TelemetryConfig,
  type SessionMetadata,
  resultCountBucket,
  normalizeMissingCategory,
} from "./types.js";

export interface FeedbackPayload {
  wasUseful: boolean;
  contextRelevance?: number;
  contextCompleteness?: number;
  noiseRatio?: number;
  missingCategory?: string;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class TelemetrySession {
  readonly id: string;

  private searchCount = 0;
  private feedbackCallCount = 0;
  private recentEmbeddings: Array<{ embedding: number[]; timestamp: number }> =
    [];

  private static readonly REDUNDANCY_WINDOW_MS = 5 * 60 * 1000;
  private static readonly REDUNDANCY_THRESHOLD = 0.8;
  private static readonly MAX_FEEDBACK_CALLS = 20;

  constructor(
    private readonly db: VirageDb,
    private readonly config: TelemetryConfig,
    sessionId: string,
    metadata: SessionMetadata,
  ) {
    this.id = sessionId;
    if (config.enabled) {
      db.insertTelemetrySession({
        id: sessionId,
        started_at: new Date().toISOString(),
        embedding_model: metadata.embeddingModel,
        chunking_strategy: metadata.chunkingStrategy,
        store_type: metadata.storeType,
        node_version: metadata.nodeVersion,
        os: metadata.os,
        total_searches: 0,
        total_tool_calls: 0,
        tools_used_json: "[]",
        flushed: 0,
      });
    }
  }

  recordSearch(
    searchId: string,
    resultCount: number,
    queryEmbedding: number[],
  ): void {
    if (!this.config.enabled || !this.config.tiers.implicit) return;

    const now = Date.now();
    const redundant = this.isRedundant(queryEmbedding, now);

    this.recentEmbeddings.push({ embedding: queryEmbedding, timestamp: now });
    const cutoff = now - TelemetrySession.REDUNDANCY_WINDOW_MS;
    this.recentEmbeddings = this.recentEmbeddings.filter(
      (e) => e.timestamp >= cutoff,
    );

    const queryHash =
      resultCount === 0
        ? createHash("sha256")
            .update(Buffer.from(new Float32Array(queryEmbedding).buffer))
            .digest("hex")
            .slice(0, 16)
        : undefined;

    this.db.insertTelemetrySearch({
      id: searchId,
      session_id: this.id,
      occurred_at: new Date(now).toISOString(),
      result_count: resultCount,
      result_count_bucket: resultCountBucket(resultCount),
      empty: resultCount === 0 ? 1 : 0,
      query_hash: queryHash,
      redundancy_detected: redundant ? 1 : 0,
      flushed: 0,
    });

    this.searchCount++;
    this.db.updateTelemetrySession(this.id, {
      total_searches: this.searchCount,
    });
  }

  recordLatency(phase: string, durationMs: number): void {
    if (!this.config.enabled || !this.config.tiers.implicit) return;
    this.db.insertTelemetryLatency({
      session_id: this.id,
      occurred_at: new Date().toISOString(),
      phase,
      duration_ms: durationMs,
      flushed: 0,
    });
  }

  recordError(
    errorType: string,
    retryCount: number,
    recovered: boolean,
  ): void {
    if (!this.config.enabled || !this.config.tiers.implicit) return;
    this.db.insertTelemetryError({
      session_id: this.id,
      occurred_at: new Date().toISOString(),
      error_type: errorType,
      retry_count: retryCount,
      recovered: recovered ? 1 : 0,
      flushed: 0,
    });
  }

  recordFeedback(searchId: string, payload: FeedbackPayload): void {
    if (!this.config.enabled) return;
    if (!this.config.tiers.explicit_feedback.enabled) return;
    if (this.feedbackCallCount >= TelemetrySession.MAX_FEEDBACK_CALLS) return;
    this.feedbackCallCount++;
    this.db.insertTelemetryFeedback({
      session_id: this.id,
      search_id: searchId,
      occurred_at: new Date().toISOString(),
      was_useful: payload.wasUseful ? 1 : 0,
      context_relevance: payload.contextRelevance,
      context_completeness: payload.contextCompleteness,
      noise_ratio: payload.noiseRatio,
      missing_category: normalizeMissingCategory(payload.missingCategory),
      flushed: 0,
    });
  }

  recordCacheStats(fileHitRate: number, semanticHitRate: number): void {
    if (!this.config.enabled || !this.config.tiers.implicit) return;
    this.db.insertTelemetryCacheStats({
      session_id: this.id,
      recorded_at: new Date().toISOString(),
      file_hit_rate: fileHitRate,
      semantic_hit_rate: semanticHitRate,
      flushed: 0,
    });
  }

  shouldSampleFeedback(resultCount: number): boolean {
    if (!this.config.enabled) return false;
    if (!this.config.tiers.explicit_feedback.enabled) return false;
    if (this.feedbackCallCount >= TelemetrySession.MAX_FEEDBACK_CALLS)
      return false;
    if (
      this.config.tiers.explicit_feedback.always_on_anomaly &&
      (resultCount === 0 || resultCount > 10)
    ) {
      return true;
    }
    return Math.random() < this.config.tiers.explicit_feedback.sampling_rate;
  }

  end(): void {
    if (!this.config.enabled) return;
    this.db.updateTelemetrySession(this.id, {
      ended_at: new Date().toISOString(),
    });
  }

  private isRedundant(embedding: number[], now: number): boolean {
    const cutoff = now - TelemetrySession.REDUNDANCY_WINDOW_MS;
    return this.recentEmbeddings
      .filter((e) => e.timestamp >= cutoff)
      .some(
        (e) =>
          cosineSimilarity(e.embedding, embedding) >
          TelemetrySession.REDUNDANCY_THRESHOLD,
      );
  }
}
