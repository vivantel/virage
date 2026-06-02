import { describe, it, expect, vi } from "vitest";
import { getQueryPerfReport } from "./query-perf.js";
import type { Collection } from "chromadb";

function makeCollection(
  overrides: Partial<{
    get: () => Promise<unknown>;
    query: () => Promise<unknown>;
    queryDelayMs: number;
  }> = {},
): Collection {
  const delay = overrides.queryDelayMs ?? 2;

  return {
    get:
      overrides.get ?? vi.fn().mockResolvedValue({ embeddings: [], ids: [] }),
    query:
      overrides.query ??
      vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ ids: [[]] }), delay),
            ),
        ),
  } as unknown as Collection;
}

describe("getQueryPerfReport (ChromaDB)", () => {
  it("returns valid latency percentiles (p50 ≤ p95 ≤ p99)", async () => {
    const report = await getQueryPerfReport(makeCollection({ queryDelayMs: 2 }), 384, 24);

    expect(report.timeframeHours).toBe(24);
    expect(report.p50LatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.p95LatencyMs).toBeGreaterThanOrEqual(report.p50LatencyMs);
    expect(report.p99LatencyMs).toBeGreaterThanOrEqual(report.p95LatencyMs);
  });

  it("timeframeHours is reflected in the report", async () => {
    const report = await getQueryPerfReport(makeCollection(), 384, 48);
    expect(report.timeframeHours).toBe(48);
  });

  it("slowQueryCount is 0 for fast queries (< 100 ms)", async () => {
    const report = await getQueryPerfReport(makeCollection({ queryDelayMs: 1 }), 384, 24);
    expect(report.slowQueryCount).toBe(0);
  });

  it("returns healthy suggestion when p95 ≤ 100 ms", async () => {
    const report = await getQueryPerfReport(makeCollection({ queryDelayMs: 1 }), 384, 24);
    expect(report.suggestedIndexes[0]).toMatch(/healthy/i);
  });

  it("uses real embeddings from collection.get() when available", async () => {
    const fakeEmbeddings = [Array(4).fill(0.1), Array(4).fill(0.2)];
    const querySpy = vi.fn().mockResolvedValue({ ids: [[]] });
    const collection = makeCollection({
      get: vi.fn().mockResolvedValue({ embeddings: fakeEmbeddings, ids: ["a", "b"] }),
      query: querySpy,
    });

    await getQueryPerfReport(collection, 4, 24);

    // Exactly 2 real embeddings → exactly 2 query calls
    expect(querySpy).toHaveBeenCalledTimes(2);
    const firstArg = querySpy.mock.calls[0][0] as { queryEmbeddings: number[][] };
    expect(firstArg.queryEmbeddings[0]).toEqual(expect.arrayContaining([0.1]));
  });

  it("falls back to 20 synthetic zero-vectors when collection.get() fails", async () => {
    const querySpy = vi.fn().mockResolvedValue({ ids: [[]] });
    const collection = makeCollection({
      get: vi.fn().mockRejectedValue(new Error("not supported")),
      query: querySpy,
    });

    const report = await getQueryPerfReport(collection, 384, 24);

    expect(report.p50LatencyMs).toBeGreaterThanOrEqual(0);
    // 20 synthetic samples (SAMPLE_COUNT)
    expect(querySpy).toHaveBeenCalledTimes(20);
  });

  it("suggests HNSW tuning when p95 > 100 ms", async () => {
    const report = await getQueryPerfReport(makeCollection({ queryDelayMs: 120 }), 384, 24);

    expect(report.suggestedIndexes[0]).toMatch(/HNSW|hnsw/i);
  }, 15_000);

  it("handles query errors gracefully (still returns a complete report)", async () => {
    const collection = makeCollection({
      query: vi.fn().mockRejectedValue(new Error("connection refused")),
    });

    const report = await getQueryPerfReport(collection, 384, 24);

    expect(report.p50LatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.slowQueryCount).toBeGreaterThanOrEqual(0);
    expect(report.suggestedIndexes.length).toBeGreaterThan(0);
  });
}, 60_000);
