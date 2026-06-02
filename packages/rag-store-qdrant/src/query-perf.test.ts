import { describe, it, expect, vi, afterEach } from "vitest";
import { getQueryPerfReport } from "./query-perf.js";

// Prometheus histogram text helpers
function prometheusMetrics(entries: { sum: number; count: number }[]): string {
  return entries
    .map(
      ({ sum, count }, i) =>
        `rest_api_response_duration_seconds_sum{method="POST",endpoint="/search/${i}",status="200"} ${sum}\n` +
        `rest_api_response_duration_seconds_count{method="POST",endpoint="/search/${i}",status="200"} ${count}`,
    )
    .join("\n");
}

function mockFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    text: vi.fn().mockResolvedValue(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const UNAVAILABLE_SENTINEL = -1;

describe("getQueryPerfReport (Qdrant)", () => {
  describe("metrics endpoint unavailable", () => {
    it("returns all -1 latencies when fetch throws", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      );

      const report = await getQueryPerfReport(
        "http://localhost:6333",
        "docs",
        24,
      );

      expect(report.p50LatencyMs).toBe(UNAVAILABLE_SENTINEL);
      expect(report.p95LatencyMs).toBe(UNAVAILABLE_SENTINEL);
      expect(report.p99LatencyMs).toBe(UNAVAILABLE_SENTINEL);
      expect(report.slowQueryCount).toBe(UNAVAILABLE_SENTINEL);
    });

    it("returns all -1 latencies when /metrics returns non-OK status", async () => {
      vi.stubGlobal("fetch", mockFetch(503, "Service Unavailable"));

      const report = await getQueryPerfReport(
        "http://localhost:6333",
        "docs",
        24,
      );

      expect(report.p50LatencyMs).toBe(UNAVAILABLE_SENTINEL);
    });

    it("returns all -1 latencies when /metrics body has no matching histogram lines", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch(200, "# HELP other_metric something\nother_metric 1.0\n"),
      );

      const report = await getQueryPerfReport(
        "http://localhost:6333",
        "docs",
        24,
      );

      expect(report.p50LatencyMs).toBe(UNAVAILABLE_SENTINEL);
    });

    it("includes a telemetry-not-available hint in suggestedIndexes", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

      const report = await getQueryPerfReport(
        "http://localhost:6333",
        "docs",
        24,
      );

      expect(report.suggestedIndexes[0]).toMatch(/telemetry|metrics/i);
    });

    it("preserves timeframeHours even when unavailable", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

      const report = await getQueryPerfReport(
        "http://localhost:6333",
        "docs",
        48,
      );

      expect(report.timeframeHours).toBe(48);
    });
  });

  describe("metrics endpoint reachable", () => {
    it("computes valid percentiles from Prometheus histogram (p50 ≤ p95 ≤ p99)", async () => {
      // 5 entries, mean latencies 10ms–50ms (0.01–0.05 s)
      const body = prometheusMetrics([
        { sum: 0.05, count: 5 }, // mean 0.01 s = 10 ms
        { sum: 0.06, count: 3 }, // mean 0.02 s = 20 ms
        { sum: 0.09, count: 3 }, // mean 0.03 s = 30 ms
        { sum: 0.16, count: 4 }, // mean 0.04 s = 40 ms
        { sum: 0.25, count: 5 }, // mean 0.05 s = 50 ms
      ]);
      vi.stubGlobal("fetch", mockFetch(200, body));

      const report = await getQueryPerfReport(
        "http://localhost:6333",
        "docs",
        24,
      );

      expect(report.p50LatencyMs).toBeGreaterThanOrEqual(0);
      expect(report.p95LatencyMs).toBeGreaterThanOrEqual(report.p50LatencyMs);
      expect(report.p99LatencyMs).toBeGreaterThanOrEqual(report.p95LatencyMs);
    });

    it("timeframeHours is passed through to the report", async () => {
      const body = prometheusMetrics([{ sum: 0.05, count: 5 }]);
      vi.stubGlobal("fetch", mockFetch(200, body));

      const report = await getQueryPerfReport(
        "http://localhost:6333",
        "docs",
        72,
      );

      expect(report.timeframeHours).toBe(72);
    });

    it("counts slow queries when mean latency > 100 ms", async () => {
      // 2 fast entries (10ms, 50ms) + 2 slow (150ms, 200ms)
      const body = prometheusMetrics([
        { sum: 0.05, count: 5 }, // 10 ms
        { sum: 0.15, count: 3 }, // 50 ms
        { sum: 0.45, count: 3 }, // 150 ms — slow
        { sum: 0.4, count: 2 }, // 200 ms — slow
      ]);
      vi.stubGlobal("fetch", mockFetch(200, body));

      const report = await getQueryPerfReport(
        "http://localhost:6333",
        "docs",
        24,
      );

      expect(report.slowQueryCount).toBeGreaterThan(0);
      expect(report.suggestedIndexes[0]).toMatch(/slow|hnsw/i);
    });

    it("returns healthy suggestion when no slow queries", async () => {
      const body = prometheusMetrics([
        { sum: 0.02, count: 4 }, // 5 ms
        { sum: 0.06, count: 3 }, // 20 ms
      ]);
      vi.stubGlobal("fetch", mockFetch(200, body));

      const report = await getQueryPerfReport(
        "http://localhost:6333",
        "docs",
        24,
      );

      expect(report.slowQueryCount).toBe(0);
      expect(report.suggestedIndexes[0]).toMatch(/healthy/i);
    });

    it("normalises the metrics URL by stripping a trailing slash", async () => {
      const fetchSpy = mockFetch(
        200,
        prometheusMetrics([{ sum: 0.01, count: 2 }]),
      );
      vi.stubGlobal("fetch", fetchSpy);

      await getQueryPerfReport("http://localhost:6333/", "docs", 24);

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toBe("http://localhost:6333/metrics");
    });

    it("ignores histogram entries where count is 0", async () => {
      const body =
        'rest_api_response_duration_seconds_sum{method="POST"} 0\n' +
        'rest_api_response_duration_seconds_count{method="POST"} 0\n';
      vi.stubGlobal("fetch", mockFetch(200, body));

      const report = await getQueryPerfReport(
        "http://localhost:6333",
        "docs",
        24,
      );

      // zero-count entry produces no samples → falls back to UNAVAILABLE
      expect(report.p50LatencyMs).toBe(UNAVAILABLE_SENTINEL);
    });
  });
});
