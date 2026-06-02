import { describe, it, expect, vi } from "vitest";
import { getQueryPerfReport } from "./query-perf.js";

function makeTable(searchDelayMs = 5) {
  return {
    vectorSearch: vi.fn().mockReturnValue({
      column: vi.fn().mockReturnThis(),
      distanceType: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve([]), searchDelayMs),
            ),
        ),
    }),
  };
}

describe("getQueryPerfReport (LanceDB)", () => {
  it("returns valid latency percentiles (p50 ≤ p95 ≤ p99)", async () => {
    const report = await getQueryPerfReport(makeTable(1), 384, 24);

    expect(report.timeframeHours).toBe(24);
    expect(report.p50LatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.p95LatencyMs).toBeGreaterThanOrEqual(report.p50LatencyMs);
    expect(report.p99LatencyMs).toBeGreaterThanOrEqual(report.p95LatencyMs);
  });

  it("timeframeHours is reflected in the report", async () => {
    const report = await getQueryPerfReport(makeTable(1), 384, 48);
    expect(report.timeframeHours).toBe(48);
  });

  it("slowQueryCount is 0 for fast queries (< 100 ms)", async () => {
    const report = await getQueryPerfReport(makeTable(1), 384, 24);
    expect(report.slowQueryCount).toBe(0);
  });

  it("returns healthy suggestion when p95 latency ≤ 50 ms", async () => {
    const report = await getQueryPerfReport(makeTable(1), 384, 24);
    expect(report.suggestedIndexes[0]).toMatch(/healthy/i);
  });

  it("suggests IVF-PQ when p95 latency > 50 ms", async () => {
    const report = await getQueryPerfReport(makeTable(80), 384, 24);
    expect(report.suggestedIndexes[0]).toMatch(/IVF-PQ/i);
  }, 10_000);

  it("records timing even when table.vectorSearch throws", async () => {
    const table = {
      vectorSearch: vi.fn().mockReturnValue({
        column: vi.fn().mockReturnThis(),
        distanceType: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockRejectedValue(new Error("table is empty")),
      }),
    };

    const report = await getQueryPerfReport(table, 384, 24);

    // Must still return a report with valid (≥ 0) latencies
    expect(report.p50LatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.slowQueryCount).toBeGreaterThanOrEqual(0);
  });

  it("uses the provided dimensions to build the zero-vector query", async () => {
    const searchSpy = vi.fn().mockReturnValue({
      column: vi.fn().mockReturnThis(),
      distanceType: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    await getQueryPerfReport({ vectorSearch: searchSpy }, 128, 24);

    // vectorSearch should have been called with a 128-dimensional zero vector
    const firstArg = searchSpy.mock.calls[0][0] as number[];
    expect(firstArg).toHaveLength(128);
    expect(firstArg.every((v) => v === 0)).toBe(true);
  });
}, 30_000);
