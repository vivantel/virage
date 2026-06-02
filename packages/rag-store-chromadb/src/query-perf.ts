import type { QueryPerfReport } from "@vivantel/rag-core";
import { IncludeEnum } from "chromadb";
import type { Collection } from "chromadb";

const SAMPLE_COUNT = 20;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return -1;
  return (
    sorted[Math.floor((p / 100) * sorted.length)] ??
    sorted[sorted.length - 1] ??
    0
  );
}

export async function getQueryPerfReport(
  collection: Collection,
  dimensions: number,
  timeframeHours: number,
): Promise<QueryPerfReport> {
  // Try to fetch real embeddings for representative queries; fall back to zero vectors.
  let sampleEmbeddings: number[][] = [];

  try {
    const result = await collection.get({
      include: [IncludeEnum.Embeddings],
      limit: SAMPLE_COUNT,
    });
    if (result.embeddings && result.embeddings.length > 0) {
      sampleEmbeddings = result.embeddings.map((e) =>
        Array.from(e as ArrayLike<number>),
      );
    }
  } catch {
    // Fall through to synthetic vectors
  }

  if (sampleEmbeddings.length === 0) {
    sampleEmbeddings = Array.from({ length: SAMPLE_COUNT }, () =>
      Array<number>(dimensions).fill(0),
    );
  }

  const latencies: number[] = [];

  for (const embedding of sampleEmbeddings) {
    const start = performance.now();
    try {
      await collection.query({
        queryEmbeddings: [embedding],
        nResults: 10,
        include: [] as [],
      });
    } catch {
      // Empty collection or other transient error — still record timing
    }
    latencies.push(performance.now() - start);
  }

  latencies.sort((a, b) => a - b);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const slowQueryCount = latencies.filter((ms) => ms > 100).length;

  const suggestedIndexes: string[] = [];
  if (p95 > 100) {
    suggestedIndexes.push(
      `p95 latency (${p95.toFixed(1)} ms) is high. ` +
        `Consider increasing ChromaDB server resources or tuning HNSW ef_search.`,
    );
  } else {
    suggestedIndexes.push("Query performance looks healthy.");
  }

  return {
    timeframeHours,
    p50LatencyMs: Math.round(p50 * 10) / 10,
    p95LatencyMs: Math.round(p95 * 10) / 10,
    p99LatencyMs: Math.round(p99 * 10) / 10,
    slowQueryCount,
    suggestedIndexes,
  };
}
