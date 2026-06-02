import { describe, it, expect, vi } from "vitest";
import { getQueryPerfReport } from "./query-perf.js";

function makeTable(searchDelayMs = 5) {
  return {
    vectorSearch: vi.fn().mockReturnValue({
      column: vi.fn().mockReturnThis(),
      distanceType: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve([]), searchDelayMs),
          ),
      ),
    }),
  };
}

describe("getQueryPerfReport (LanceDB)", () => {
  it("returns valid latency percentiles", async () => {
    const table = makeTable(1);
    const report = await getQueryPerfReport(table, 384, 24);

    expect(report.timeframeHours).toBe(24);
    expect(report.p50LatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.p95LatencyMs).toBeGreaterThanOrEqual(report.p50LatencyMs);
    expect(report.p99LatencyMs).toBeGreaterThanOrEqual(report.p95LatencyMs);
  });

  it("slowQueryCount is 0 for fast queries", async () => {
    const table = makeTable(1); // 1 ms per query
    const report = await getQueryPerfReport(table, 384, 24);

    expect(report.slowQueryCount).toBe(0);
  });

  it("suggests IVF-PQ when p95 latency > 50 ms", async () => {
    const table = makeTable(80); // 80 ms per query → p95 > 50
    const report = await getQueryPerfReport(table, 384, 24);

    expect(report.suggestedIndexes[0]).toMatch(/IVF-PQ/i);
  }, 10_000);

  it("handles table search errors gracefully (still returns a report)", async () => {
    const table = {
      vectorSearch: vi.fn().mockReturnValue({
        column: vi.fn().mockReturnThis(),
        distanceType: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockRejectedValue(new Error("table is empty")),
      }),
    };

    const report = await getQueryPerfReport(table, 384, 24);

    expect(report.p50LatencyMs).toBeGreaterThanOrEqual(0);
  });
}, 30_000);
