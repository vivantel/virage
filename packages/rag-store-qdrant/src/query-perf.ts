import type { QueryPerfReport } from "@vivantel/rag-core";

const UNAVAILABLE: QueryPerfReport = {
  timeframeHours: 0,
  p50LatencyMs: -1,
  p95LatencyMs: -1,
  p99LatencyMs: -1,
  slowQueryCount: -1,
  suggestedIndexes: [
    "Qdrant telemetry not available. Ensure the /metrics endpoint is reachable " +
      "and telemetry is enabled in your Qdrant configuration.",
  ],
};

export async function getQueryPerfReport(
  qdrantUrl: string,
  _collection: string,
  timeframeHours: number,
): Promise<QueryPerfReport> {
  const metricsUrl = `${qdrantUrl.replace(/\/$/, "")}/metrics`;

  let text: string;
  try {
    const res = await fetch(metricsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ...UNAVAILABLE, timeframeHours };
    text = await res.text();
  } catch {
    return { ...UNAVAILABLE, timeframeHours };
  }

  const latencies = parsePrometheusHistogram(text);
  if (latencies.length === 0) {
    return { ...UNAVAILABLE, timeframeHours };
  }

  latencies.sort((a, b) => a - b);

  const percentile = (p: number): number =>
    latencies[Math.floor((p / 100) * latencies.length)] ?? 0;

  const p50 = percentile(50) * 1000;
  const p95 = percentile(95) * 1000;
  const p99 = percentile(99) * 1000;
  const slowQueryCount = latencies.filter((ms) => ms * 1000 > 100).length;

  const suggestedIndexes: string[] = [];
  if (slowQueryCount > 0) {
    suggestedIndexes.push(
      `${slowQueryCount} slow queries (>100ms) detected. Consider tuning hnsw_config ef or increasing hardware resources.`,
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

/**
 * Reconstruct a latency sample list from Prometheus histogram sum/count lines.
 * Returns latency values in seconds.
 */
function parsePrometheusHistogram(text: string): number[] {
  const samples: number[] = [];

  // Match _sum and _count lines for REST API duration metrics
  const sumPattern =
    /^rest_api_response_duration_seconds_sum\{[^}]*\}\s+([\d.e+]+)/gm;
  const countPattern =
    /^rest_api_response_duration_seconds_count\{[^}]*\}\s+([\d.e+]+)/gm;

  const sums: number[] = [];
  const counts: number[] = [];

  for (const m of text.matchAll(sumPattern)) {
    sums.push(parseFloat(m[1]));
  }
  for (const m of text.matchAll(countPattern)) {
    counts.push(parseFloat(m[1]));
  }

  for (let i = 0; i < Math.min(sums.length, counts.length); i++) {
    const count = counts[i];
    const sum = sums[i];
    if (count > 0 && sum >= 0) {
      const mean = sum / count;
      // Approximate distribution: repeat the mean `min(count, 10)` times
      const weight = Math.min(Math.round(count), 10);
      for (let j = 0; j < weight; j++) {
        samples.push(mean);
      }
    }
  }

  return samples;
}
