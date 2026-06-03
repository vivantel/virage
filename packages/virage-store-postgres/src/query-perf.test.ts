import { describe, it, expect, vi } from "vitest";
import { getQueryPerfReport } from "./query-perf.js";
import type pg from "pg";

// Query call order:
//   1. SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_stat_statements'
//   2. SELECT mean_exec_time, stddev_exec_time, calls, query FROM pg_stat_statements ...
//      (only when extension is present)

type Row = Record<string, unknown>;

function makePool(queryResults: { rows: Row[] }[]) {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  for (const result of queryResults) {
    client.query.mockResolvedValueOnce(result);
  }
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as pg.Pool;
  return { pool, client };
}

const EXTENSION_ABSENT = [{ rows: [{ count: "0" }] }];
const EXTENSION_PRESENT = { rows: [{ count: "1" }] };

function makeStatRow(
  mean_exec_time: number,
  calls: number,
  query = "SELECT id FROM documents",
): Row {
  return { mean_exec_time, stddev_exec_time: 5, calls, query };
}

describe("getQueryPerfReport (PostgreSQL)", () => {
  describe("pg_stat_statements not installed", () => {
    it("returns all -1 latencies and an enable-extension suggestion", async () => {
      const { pool } = makePool(EXTENSION_ABSENT);

      const report = await getQueryPerfReport(pool, "documents", 24);

      expect(report.p50LatencyMs).toBe(-1);
      expect(report.p95LatencyMs).toBe(-1);
      expect(report.p99LatencyMs).toBe(-1);
      expect(report.slowQueryCount).toBe(-1);
      expect(report.suggestedIndexes[0]).toMatch(/pg_stat_statements/i);
    });

    it("preserves the requested timeframeHours in the response", async () => {
      const { pool } = makePool(EXTENSION_ABSENT);

      const report = await getQueryPerfReport(pool, "documents", 48);

      expect(report.timeframeHours).toBe(48);
    });
  });

  describe("pg_stat_statements installed, no rows for the table", () => {
    it("returns zero latencies and a no-queries message", async () => {
      const { pool } = makePool([EXTENSION_PRESENT, { rows: [] }]);

      const report = await getQueryPerfReport(pool, "documents", 24);

      expect(report.p50LatencyMs).toBe(0);
      expect(report.p95LatencyMs).toBe(0);
      expect(report.p99LatencyMs).toBe(0);
      expect(report.slowQueryCount).toBe(0);
      expect(report.suggestedIndexes[0]).toMatch(/No queries found/i);
    });
  });

  describe("query stats present", () => {
    it("returns valid percentiles (p50 ≤ p95 ≤ p99)", async () => {
      const { pool } = makePool([
        EXTENSION_PRESENT,
        { rows: [makeStatRow(10, 5), makeStatRow(30, 3), makeStatRow(80, 8)] },
      ]);

      const report = await getQueryPerfReport(pool, "documents", 24);

      expect(report.p50LatencyMs).toBeGreaterThanOrEqual(0);
      expect(report.p95LatencyMs).toBeGreaterThanOrEqual(report.p50LatencyMs);
      expect(report.p99LatencyMs).toBeGreaterThanOrEqual(report.p95LatencyMs);
    });

    it("timeframeHours is passed through to the report", async () => {
      const { pool } = makePool([
        EXTENSION_PRESENT,
        { rows: [makeStatRow(5, 1)] },
      ]);

      const report = await getQueryPerfReport(pool, "documents", 72);

      expect(report.timeframeHours).toBe(72);
    });

    it("identifies slow queries (mean_exec_time > 100 ms)", async () => {
      const { pool } = makePool([
        EXTENSION_PRESENT,
        {
          rows: [
            makeStatRow(50, 3), // fast
            makeStatRow(150, 2), // slow
            makeStatRow(200, 1), // slow
          ],
        },
      ]);

      const report = await getQueryPerfReport(pool, "documents", 24);

      expect(report.slowQueryCount).toBe(2);
      expect(report.suggestedIndexes[0]).toMatch(/slow queries/i);
    });

    it("suggests healthy when all queries are fast", async () => {
      const { pool } = makePool([
        EXTENSION_PRESENT,
        { rows: [makeStatRow(20, 5), makeStatRow(40, 3)] },
      ]);

      const report = await getQueryPerfReport(pool, "documents", 24);

      expect(report.slowQueryCount).toBe(0);
      expect(report.suggestedIndexes[0]).toMatch(/healthy/i);
    });

    it("detects sequential scans in query text", async () => {
      const { pool } = makePool([
        EXTENSION_PRESENT,
        {
          rows: [
            {
              mean_exec_time: 50,
              stddev_exec_time: 5,
              calls: 1,
              query: "seq scan on documents",
            },
          ],
        },
      ]);

      const report = await getQueryPerfReport(pool, "documents", 24);

      expect(report.suggestedIndexes.some((s) => /sequential/i.test(s))).toBe(
        true,
      );
    });

    it("caps per-row weight at 10 samples regardless of call count", async () => {
      const { pool } = makePool([
        EXTENSION_PRESENT,
        { rows: [makeStatRow(10, 10_000)] }, // very high call count
      ]);

      // Should not throw or run out of memory
      const report = await getQueryPerfReport(pool, "documents", 24);

      expect(report.p50LatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("client lifecycle", () => {
    it("releases the client even when a query throws", async () => {
      const client = {
        query: vi.fn().mockRejectedValue(new Error("connection reset")),
        release: vi.fn(),
      };
      const pool = {
        connect: vi.fn().mockResolvedValue(client),
      } as unknown as pg.Pool;

      await expect(getQueryPerfReport(pool, "documents", 24)).rejects.toThrow(
        "connection reset",
      );

      expect(client.release).toHaveBeenCalledOnce();
    });
  });
});
