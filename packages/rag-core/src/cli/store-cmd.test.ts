import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IndexStats, QueryPerfReport } from "../interfaces/quality.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../config-loader.js", () => ({
  loadConfig: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { loadConfig } from "../config-loader.js";
import { runStoreStats, runStorePerf } from "./store-cmd.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_INDEX_STATS: IndexStats = {
  totalVectors: 12_500,
  indexType: "hnsw",
  annRecallAt10: 0.97,
  indexAgeHours: 2,
  deadTupleFraction: 0.01,
  suggestions: ["Index looks healthy."],
};

const MOCK_PERF_REPORT: QueryPerfReport = {
  timeframeHours: 24,
  p50LatencyMs: 8,
  p95LatencyMs: 22,
  p99LatencyMs: 45,
  slowQueryCount: 0,
  suggestedIndexes: ["Query performance looks healthy."],
};

function makeBaseStore() {
  return {
    name: "mock-store",
    initialize: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn(),
    deleteBySourceFile: vi.fn(),
    getCurrentState: vi.fn().mockResolvedValue(new Map()),
    search: vi.fn().mockResolvedValue([]),
  };
}

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

// ---------------------------------------------------------------------------
// runStoreStats
// ---------------------------------------------------------------------------

describe("runStoreStats", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new ExitError(code ?? 0);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs error and exits when store does not implement getIndexStats", async () => {
    const store = makeBaseStore();
    vi.mocked(loadConfig).mockResolvedValue({
      vectorStore: store,
      embedder: {} as never,
      chunkers: [],
    } as never);

    await expect(
      runStoreStats({ config: "./rag.config.json" }),
    ).rejects.toThrow(ExitError);

    const errOutput = consoleErrorSpy.mock.calls.flat().join("\n");
    expect(errOutput).toMatch(/mock-store/);
    expect(errOutput).toMatch(/does not support/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prints formatted IndexStats table when store supports getIndexStats", async () => {
    const store = {
      ...makeBaseStore(),
      getIndexStats: vi.fn().mockResolvedValue(MOCK_INDEX_STATS),
    };
    vi.mocked(loadConfig).mockResolvedValue({
      vectorStore: store,
      embedder: {} as never,
      chunkers: [],
    } as never);

    await runStoreStats({ config: "./rag.config.json" });

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toContain("12,500");
    expect(output).toContain("hnsw");
    expect(output).toContain("97.0%");
    expect(output).toContain("Index looks healthy");
  });
});

// ---------------------------------------------------------------------------
// runStorePerf
// ---------------------------------------------------------------------------

describe("runStorePerf", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new ExitError(code ?? 0);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs error and exits when store does not implement getQueryPerfReport", async () => {
    const store = makeBaseStore();
    vi.mocked(loadConfig).mockResolvedValue({
      vectorStore: store,
      embedder: {} as never,
      chunkers: [],
    } as never);

    await expect(
      runStorePerf({ config: "./rag.config.json", timeframeHours: 24 }),
    ).rejects.toThrow(ExitError);

    const errOutput = consoleErrorSpy.mock.calls.flat().join("\n");
    expect(errOutput).toMatch(/mock-store/);
    expect(errOutput).toMatch(/does not support/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prints formatted QueryPerfReport when store supports getQueryPerfReport", async () => {
    const store = {
      ...makeBaseStore(),
      getQueryPerfReport: vi.fn().mockResolvedValue(MOCK_PERF_REPORT),
    };
    vi.mocked(loadConfig).mockResolvedValue({
      vectorStore: store,
      embedder: {} as never,
      chunkers: [],
    } as never);

    await runStorePerf({ config: "./rag.config.json", timeframeHours: 24 });

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toContain("8 ms"); // p50
    expect(output).toContain("22 ms"); // p95
    expect(output).toContain("45 ms"); // p99
    expect(output).toContain("Query performance looks healthy");
  });
});
