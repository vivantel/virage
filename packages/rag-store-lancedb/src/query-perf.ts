import type { QueryPerfReport } from "@vivantel/rag-core";

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
  table: any,
  dimensions: number,
  timeframeHours: number,
): Promise<QueryPerfReport> {
  const zeroVector = Array<number>(dimensions).fill(0);
  const latencies: number[] = [];

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const start = performance.now();
    try {
      await table
        .vectorSearch(zeroVector)
        .column("embedding")
        .distanceType("cosine")
        .limit(10)
        .toArray();
    } catch {
      // Table may be empty or index unavailable — still record timing
    }
    latencies.push(performance.now() - start);
  }

  latencies.sort((a, b) => a - b);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const slowQueryCount = latencies.filter((ms) => ms > 100).length;

  const suggestedIndexes: string[] = [];
  if (p95 > 50) {
    suggestedIndexes.push(
      `p95 latency (${p95.toFixed(1)} ms) is high. ` +
        `Consider creating an IVF-PQ index to speed up searches.`,
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
