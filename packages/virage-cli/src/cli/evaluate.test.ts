import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EvalResult } from "@vivantel/virage-core";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports)
// ---------------------------------------------------------------------------

vi.mock("@vivantel/virage-core", () => ({
  loadConfig: vi.fn(),
  loadEvalDataset: vi.fn(),
  EvalRunner: vi.fn(),
  ExperimentStore: vi.fn(),
  makeRunId: vi.fn().mockReturnValue("eval_2026-06-02T00-00-00"),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { loadConfig, loadEvalDataset, EvalRunner, ExperimentStore } from "@vivantel/virage-core";
import { runEvaluate } from "./evaluate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GOOD_RESULT: EvalResult = {
  precisionAt5: 0.6,
  precisionAt10: 0.5,
  recallAt10: 0.7,
  mrr: 0.75,
  hitRateAt5: 0.9,
  queriesEvaluated: 5,
};

const MOCK_DATASET = {
  queries: [
    { query: "What is RAG?", expectedChunkIds: ["abc123"] },
    { query: "How does chunking work?", expectedChunkIds: ["def456"] },
  ],
};

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

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runEvaluate", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let mockSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new ExitError(code ?? 0);
    });

    mockSave = vi
      .fn()
      .mockResolvedValue("/tmp/.rag-experiments/eval_2026.json");

    vi.mocked(ExperimentStore).mockImplementation(function (this: unknown) {
      Object.assign(this as object, {
        save: mockSave,
        load: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
      });
    } as unknown as typeof ExperimentStore);

    vi.mocked(loadConfig).mockResolvedValue(makeMockConfig() as never);
    vi.mocked(loadEvalDataset).mockResolvedValue(MOCK_DATASET);

    vi.mocked(EvalRunner).mockImplementation(function (this: unknown) {
      Object.assign(this as object, {
        run: vi.fn().mockResolvedValue({
          evalResult: GOOD_RESULT,
          perQueryRrScores: [1, 0.5],
        }),
      });
    } as unknown as typeof EvalRunner);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: prints metrics and saves experiment run", async () => {
    await runEvaluate({
      config: "./virage.config.json",
      dataset: "./eval/queries.json",
      withLlmJudge: false,
      ci: false,
    });

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toContain("MRR");
    expect(output).toContain("0.7500");
    expect(output).toContain("Results saved to");

    expect(mockSave).toHaveBeenCalledOnce();
    const savedRun = mockSave.mock.calls[0][0] as Record<string, unknown>;
    expect(savedRun).toMatchObject({
      name: "eval",
      evalResult: GOOD_RESULT,
      perQueryRrScores: [1, 0.5],
    });
  });

  it("quality gate: prints success when MRR meets threshold", async () => {
    await runEvaluate({
      config: "./virage.config.json",
      dataset: "./eval/queries.json",
      withLlmJudge: false,
      thresholdMrr: 0.5,
      ci: false,
    });

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toContain("Quality gate passed");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("quality gate: prints failure when MRR is below threshold (no --ci)", async () => {
    await runEvaluate({
      config: "./virage.config.json",
      dataset: "./eval/queries.json",
      withLlmJudge: false,
      thresholdMrr: 0.9,
      ci: false,
    });

    const errOutput = consoleErrorSpy.mock.calls.flat().join("\n");
    expect(errOutput).toContain("Quality gate FAILED");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("quality gate: calls process.exit(1) when MRR below threshold with ci=true", async () => {
    await expect(
      runEvaluate({
        config: "./virage.config.json",
        dataset: "./eval/queries.json",
        withLlmJudge: false,
        thresholdMrr: 0.9,
        ci: true,
      }),
    ).rejects.toThrow(ExitError);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("withLlmJudge: prints RAGAS requires-judge message", async () => {
    await runEvaluate({
      config: "./virage.config.json",
      dataset: "./eval/queries.json",
      withLlmJudge: true,
      ci: false,
    });

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toMatch(/RAGAS|judge/i);
  });

  it("propagates error when loadEvalDataset throws", async () => {
    vi.mocked(loadEvalDataset).mockRejectedValue(
      new Error("File not found: ./eval/queries.json"),
    );

    await expect(
      runEvaluate({
        config: "./virage.config.json",
        dataset: "./eval/queries.json",
        withLlmJudge: false,
        ci: false,
      }),
    ).rejects.toThrow("File not found");
  });
});
