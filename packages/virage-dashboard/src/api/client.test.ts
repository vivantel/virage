import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client.js";

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
  });
}

describe("api client — shape check", () => {
  it("exports all dashboard API methods as functions", () => {
    const expected = [
      "status",
      "chunks",
      "anomalies",
      "projects",
      "addProject",
      "switchProject",
      "chunksAll",
      "deleteChunksFile",
      "deleteChunksAll",
      "search",
      "experiments",
      "experiment",
      "deleteExperiment",
      "compareExperiments",
    ];
    for (const method of expected) {
      expect(typeof (api as Record<string, unknown>)[method], method).toBe(
        "function",
      );
    }
  });

  it("exports analytics sub-object with all methods", () => {
    const expected = ["queries", "topTerms", "zeroResults", "stats", "perHour"];
    for (const method of expected) {
      expect(
        typeof (api.analytics as Record<string, unknown>)[method],
        method,
      ).toBe("function");
    }
  });
});

describe("api client — HTTP calls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("status() calls GET /api/status", async () => {
    const payload = { totalChunks: 100, totalEmbeddings: 100, memoryMB: 42 };
    global.fetch = mockFetch(payload);
    const result = await api.status();
    expect(global.fetch).toHaveBeenCalledWith("/api/status");
    expect(result).toEqual(payload);
  });

  it("chunks() calls GET /api/chunks", async () => {
    const payload = { histogram: [{ label: "0-100", count: 5 }] };
    global.fetch = mockFetch(payload);
    await api.chunks();
    expect(global.fetch).toHaveBeenCalledWith("/api/chunks");
  });

  it("anomalies() calls GET /api/embeddings/anomalies", async () => {
    global.fetch = mockFetch({ anomalies: [] });
    await api.anomalies();
    expect(global.fetch).toHaveBeenCalledWith("/api/embeddings/anomalies");
  });

  it("search() calls POST /api/search with body", async () => {
    global.fetch = mockFetch({ results: [] });
    await api.search("hello world", 5);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "hello world", topK: 5 }),
      }),
    );
  });

  it("addProject() posts to /api/projects/add", async () => {
    global.fetch = mockFetch({ projects: [], activeIndex: 0 });
    await api.addProject("/some/path");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects/add",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ rootPath: "/some/path" }),
      }),
    );
  });

  it("switchProject() posts to /api/projects/switch", async () => {
    global.fetch = mockFetch({ projects: [], activeIndex: 1 });
    await api.switchProject(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects/switch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ index: 1 }),
      }),
    );
  });

  it("chunksAll() without filter calls GET /api/chunks/all", async () => {
    global.fetch = mockFetch({ chunks: [] });
    await api.chunksAll();
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "/api/chunks/all",
    );
  });

  it("chunksAll() with filter encodes sourceFile in query string", async () => {
    global.fetch = mockFetch({ chunks: [] });
    await api.chunksAll("src/index.ts");
    expect(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toContain("sourceFile=src%2Findex.ts");
  });

  it("deleteChunksFile() calls DELETE /api/chunks/file", async () => {
    global.fetch = mockFetch({ ok: true });
    await api.deleteChunksFile("src/foo.ts");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/chunks/file",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("deleteChunksAll() calls DELETE /api/chunks/all", async () => {
    global.fetch = mockFetch({ ok: true });
    await api.deleteChunksAll();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/chunks/all",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("compareExperiments() posts to /api/experiments/compare", async () => {
    global.fetch = mockFetch({
      baselineMrr: 0.5,
      candidateMrr: 0.6,
      mrrDelta: 0.1,
      pValue: 0.03,
      confidenceInterval95: [0.05, 0.15],
      recommendation: "accept",
    });
    await api.compareExperiments("id-a", "id-b");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/experiments/compare",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ baseline: "id-a", candidate: "id-b" }),
      }),
    );
  });

  it("analytics.stats() calls GET /api/analytics/stats", async () => {
    global.fetch = mockFetch({
      queriesLastHour: 0,
      queriesLast24h: 0,
      avgTopSimilarity: 0,
      zeroResultRate: 0,
    });
    await api.analytics.stats();
    expect(global.fetch).toHaveBeenCalledWith("/api/analytics/stats");
  });

  it("analytics.topTerms() includes limit param", async () => {
    global.fetch = mockFetch({ terms: [] });
    await api.analytics.topTerms(10);
    expect(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toContain("limit=10");
  });

  it("analytics.perHour() includes hours param", async () => {
    global.fetch = mockFetch({ buckets: [] });
    await api.analytics.perHour(24);
    expect(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toContain("hours=24");
  });

  it("propagates HTTP errors as thrown Error", async () => {
    global.fetch = mockFetch({ error: "Not found" }, 404);
    await expect(api.status()).rejects.toThrow();
  });
});
