import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EvalResult, ExperimentRun } from "@vivantel/virage-core";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@vivantel/virage-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vivantel/virage-core")>();
  return {
    ...actual,
    loadConfig: vi.fn(),
    loadEvalDataset: vi.fn(),
    EvalRunner: vi.fn(),
    ExperimentStore: vi.fn(),
    makeRunId: vi.fn().mockReturnValue("my-exp_2026-06-02T00-00-00"),
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { loadConfig, loadEvalDataset, EvalRunner, ExperimentStore } from "@vivantel/virage-core";
import {
  runExperimentRun,
  runExperimentCompare,
  runExperimentList,
} from "./experiment.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EVAL_RESULT: EvalResult = {
  precisionAt5: 0.4,
  precisionAt10: 0.3,
  recallAt10: 0.6,
  mrr: 0.55,
  hitRateAt5: 0.8,
  queriesEvaluated: 10,
};

const BASELINE_SCORES = Array(20).fill(0.3);
const BETTER_SCORES = Array(20).fill(0.8);
const WORSE_SCORES = Array(20).fill(0.1);

function makeRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    id: "baseline_2026-06-01T12-00-00",
    name: "baseline",
    timestamp: "2026-06-01T12:00:00.000Z",
    config: {
      configFile: "./virage.config.json",
      dataset: "./eval/queries.json",
    },
    evalResult: { ...EVAL_RESULT, mrr: 0.5 },
    perQueryRrScores: BASELINE_SCORES,
    ...overrides,
  };
}

function makeMockConfig() {
  return {
    vectorStore: {
      name: "mock",
      initialize: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn(),
      deleteBySourceFile: vi.fn(),
      getCurrentState: vi.fn().mockResolvedValue(new Map()),
      search: vi.fn().mockResolvedValue([]),
    },
    embedder: {
      name: "mock-embedder",
      dimensions: 384,
      embed: vi.fn().mockResolvedValue(Array(384).fill(0)),
    },
    chunkers: [],
  };
}

// ---------------------------------------------------------------------------
// runExperimentRun
// ---------------------------------------------------------------------------

describe("runExperimentRun", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockSave = vi
      .fn()
      .mockResolvedValue("/tmp/.rag-experiments/my-exp_2026.json");

    vi.mocked(ExperimentStore).mockImplementation(function (this: unknown) {
      Object.assign(this as object, {
        save: mockSave,
        load: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
      });
    } as unknown as typeof ExperimentStore);

    vi.mocked(loadConfig).mockResolvedValue(makeMockConfig() as never);
    vi.mocked(loadEvalDataset).mockResolvedValue({
      queries: [{ query: "test query", expectedChunkIds: ["abc"] }],
    });
    vi.mocked(EvalRunner).mockImplementation(function (this: unknown) {
      Object.assign(this as object, {
        run: vi.fn().mockResolvedValue({
          evalResult: EVAL_RESULT,
          perQueryRrScores: BASELINE_SCORES,
        }),
      });
    } as unknown as typeof EvalRunner);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves experiment run with correct name, evalResult, and perQueryRrScores", async () => {
    await runExperimentRun({
      name: "my-exp",
      config: "./virage.config.json",
      dataset: "./eval/queries.json",
    });

    expect(mockSave).toHaveBeenCalledOnce();
    const saved = mockSave.mock.calls[0][0] as ExperimentRun;
    expect(saved.name).toBe("my-exp");
    expect(saved.evalResult).toEqual(EVAL_RESULT);
    expect(saved.perQueryRrScores).toEqual(BASELINE_SCORES);
    expect(saved.id).toBe("my-exp_2026-06-02T00-00-00");
  });

  it("prints MRR and saved path", async () => {
    await runExperimentRun({
      name: "my-exp",
      config: "./virage.config.json",
      dataset: "./eval/queries.json",
    });

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toContain("MRR");
    expect(output).toContain("saved to");
  });
});

// ---------------------------------------------------------------------------
// runExperimentCompare
// ---------------------------------------------------------------------------

describe("runExperimentCompare", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let mockLoad: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockLoad = vi.fn();

    vi.mocked(ExperimentStore).mockImplementation(function (this: unknown) {
      Object.assign(this as object, {
        save: vi.fn(),
        load: mockLoad,
        list: vi.fn().mockResolvedValue([]),
      });
    } as unknown as typeof ExperimentStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints p-value, CI, and verdict when both runs have per-query scores", async () => {
    const baseline = makeRun({ perQueryRrScores: BASELINE_SCORES });
    const candidate = makeRun({
      id: "candidate_2026-06-02T00-00-00",
      name: "candidate",
      evalResult: { ...EVAL_RESULT, mrr: 0.8 },
      perQueryRrScores: BETTER_SCORES,
    });
    mockLoad.mockResolvedValueOnce(baseline).mockResolvedValueOnce(candidate);

    await runExperimentCompare({
      baseline: "baseline",
      candidate: "candidate",
    });

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toMatch(/p-value/i);
    expect(output).toMatch(/CI|95%/i);
    expect(output).toMatch(/ACCEPT|REJECT|INCONCLUSIVE/i);
  });

  it("falls back to MRR delta output when per-query scores are missing", async () => {
    const baseline = makeRun({ perQueryRrScores: undefined });
    const candidate = makeRun({
      id: "candidate_2026",
      name: "candidate",
      evalResult: { ...EVAL_RESULT, mrr: 0.7 },
      perQueryRrScores: undefined,
    });
    mockLoad.mockResolvedValueOnce(baseline).mockResolvedValueOnce(candidate);

    await runExperimentCompare({
      baseline: "baseline",
      candidate: "candidate",
    });

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toMatch(/MRR delta/i);
    expect(output).toMatch(/Re-run/i);
  });

  it("prints warning when query counts differ", async () => {
    const baseline = makeRun({ perQueryRrScores: [0.5, 0.4, 0.6] });
    const candidate = makeRun({
      id: "candidate_2026",
      name: "candidate",
      evalResult: { ...EVAL_RESULT, mrr: 0.7 },
      perQueryRrScores: [0.6, 0.7],
    });
    mockLoad.mockResolvedValueOnce(baseline).mockResolvedValueOnce(candidate);

    await runExperimentCompare({
      baseline: "baseline",
      candidate: "candidate",
    });

    const warnOutput = consoleWarnSpy.mock.calls.flat().join("\n");
    expect(warnOutput).toMatch(/mismatch/i);
  });

  it("propagates error when run name does not exist", async () => {
    mockLoad.mockRejectedValue(
      new Error('Experiment "ghost" not found in ".rag-experiments"'),
    );

    await expect(
      runExperimentCompare({ baseline: "ghost", candidate: "candidate" }),
    ).rejects.toThrow("not found");
  });

  it("verdict is ACCEPT when candidate is clearly better", async () => {
    const baseline = makeRun({ perQueryRrScores: BASELINE_SCORES });
    const candidate = makeRun({
      id: "candidate_2026",
      name: "candidate",
      evalResult: { ...EVAL_RESULT, mrr: 0.8 },
      perQueryRrScores: BETTER_SCORES,
    });
    mockLoad.mockResolvedValueOnce(baseline).mockResolvedValueOnce(candidate);

    await runExperimentCompare({
      baseline: "baseline",
      candidate: "candidate",
    });

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toContain("ACCEPT");
  });

  it("verdict is REJECT when candidate is clearly worse", async () => {
    const baseline = makeRun({
      evalResult: { ...EVAL_RESULT, mrr: 0.8 },
      perQueryRrScores: BETTER_SCORES,
    });
    const candidate = makeRun({
      id: "candidate_2026",
      name: "candidate",
      evalResult: { ...EVAL_RESULT, mrr: 0.1 },
      perQueryRrScores: WORSE_SCORES,
    });
    mockLoad.mockResolvedValueOnce(baseline).mockResolvedValueOnce(candidate);

    await runExperimentCompare({
      baseline: "baseline",
      candidate: "candidate",
    });

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toContain("REJECT");
  });
});

// ---------------------------------------------------------------------------
// runExperimentList
// ---------------------------------------------------------------------------

describe("runExperimentList", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockList = vi.fn();

    vi.mocked(ExperimentStore).mockImplementation(function (this: unknown) {
      Object.assign(this as object, {
        save: vi.fn(),
        load: vi.fn(),
        list: mockList,
      });
    } as unknown as typeof ExperimentStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints table of runs sorted newest-first", async () => {
    const runs: ExperimentRun[] = [
      makeRun({
        id: "exp-a_2026-01",
        name: "exp-a",
        timestamp: "2026-06-01T10:00:00.000Z",
      }),
      makeRun({
        id: "exp-b_2026-02",
        name: "exp-b",
        timestamp: "2026-06-02T10:00:00.000Z",
      }),
    ];
    mockList.mockResolvedValue(runs);

    await runExperimentList();

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toContain("exp-a_2026-01");
    expect(output).toContain("exp-b_2026-02");
    // exp-b (newer) should appear before exp-a
    const idxA = output.indexOf("exp-a_2026-01");
    const idxB = output.indexOf("exp-b_2026-02");
    expect(idxB).toBeLessThan(idxA);
  });

  it("prints empty-list message when no runs exist", async () => {
    mockList.mockResolvedValue([]);

    await runExperimentList();

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toMatch(/no experiment runs/i);
  });
});
