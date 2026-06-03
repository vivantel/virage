import type { QueryPerfReport } from "@vivantel/virage-core";
import pg from "pg";

export async function getQueryPerfReport(
  pool: pg.Pool,
  table: string,
  timeframeHours: number,
): Promise<QueryPerfReport> {
  const client = await pool.connect();
  try {
    // Check if pg_stat_statements extension is available
    const extRes = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pg_extension WHERE extname = 'pg_stat_statements'`,
    );
    const hasExtension = parseInt(extRes.rows[0]?.count ?? "0", 10) > 0;

    if (!hasExtension) {
      return {
        timeframeHours,
        p50LatencyMs: -1,
        p95LatencyMs: -1,
        p99LatencyMs: -1,
        slowQueryCount: -1,
        suggestedIndexes: [
          `Enable pg_stat_statements for query performance monitoring: ` +
            `ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'; ` +
            `SELECT pg_reload_conf();`,
        ],
      };
    }

    // pg_stat_statements doesn't filter by time natively, we use what's available
    const res = await client.query<{
      mean_exec_time: number;
      stddev_exec_time: number;
      calls: number;
      query: string;
    }>(
      `SELECT mean_exec_time, stddev_exec_time, calls, query
       FROM pg_stat_statements
       WHERE query ILIKE $1
         AND query NOT ILIKE '%pg_stat_statements%'
         AND query NOT ILIKE '%pg_indexes%'
       ORDER BY mean_exec_time DESC
       LIMIT 100`,
      [`%${table}%`],
    );

    if (res.rows.length === 0) {
      return {
        timeframeHours,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        slowQueryCount: 0,
        suggestedIndexes: [
          `No queries found for table "${table}" in pg_stat_statements`,
        ],
      };
    }

    // Build latency distribution by expanding mean ± stddev approximation
    const latencies: number[] = [];
    for (const row of res.rows) {
      // Include each query weighted by its call count (capped at 10 for memory)
      const weight = Math.min(row.calls, 10);
      for (let i = 0; i < weight; i++) {
        latencies.push(row.mean_exec_time);
      }
    }
    latencies.sort((a, b) => a - b);

    const percentile = (p: number) =>
      latencies[Math.floor((p / 100) * latencies.length)] ?? 0;

    const slowQueryCount = res.rows.filter(
      (r) => r.mean_exec_time > 100,
    ).length;

    const suggestedIndexes: string[] = [];
    if (slowQueryCount > 0) {
      suggestedIndexes.push(
        `${slowQueryCount} slow queries (>100ms) found. Consider reviewing index configuration.`,
      );
    }
    if (res.rows.some((r) => r.query.toLowerCase().includes("seq scan"))) {
      suggestedIndexes.push(
        `Sequential scans detected. Ensure the embedding index is being used.`,
      );
    }
    if (suggestedIndexes.length === 0) {
      suggestedIndexes.push("Query performance looks healthy.");
    }

    return {
      timeframeHours,
      p50LatencyMs: Math.round(percentile(50) * 10) / 10,
      p95LatencyMs: Math.round(percentile(95) * 10) / 10,
      p99LatencyMs: Math.round(percentile(99) * 10) / 10,
      slowQueryCount,
      suggestedIndexes,
    };
  } finally {
    client.release();
  }
}
