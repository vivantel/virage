import { describe, it, expect } from "vitest";
import {
  precisionAtK,
  recallAtK,
  reciprocalRank,
  hitRateAtK,
  aggregateEvalResults,
  computeEvalResult,
} from "./metrics.js";

describe("precisionAtK", () => {
  it("returns correct fraction of hits in top-K", () => {
    const retrieved = ["A", "B", "C", "D", "E", "F"];
    const relevant = new Set(["A", "C"]);
    expect(precisionAtK(retrieved, relevant, 5)).toBeCloseTo(2 / 5);
  });

  it("returns 0 when no hits", () => {
    expect(precisionAtK(["X", "Y"], new Set(["A"]), 2)).toBe(0);
  });

  it("returns 0 for k=0", () => {
    expect(precisionAtK(["A"], new Set(["A"]), 0)).toBe(0);
  });

  it("handles k larger than retrieved list", () => {
    expect(precisionAtK(["A", "B"], new Set(["A"]), 10)).toBeCloseTo(1 / 10);
  });
});

describe("recallAtK", () => {
  it("returns correct recall fraction", () => {
    const retrieved = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const relevant = new Set(["A", "C", "Z"]);
    expect(recallAtK(retrieved, relevant, 10)).toBeCloseTo(2 / 3);
  });

  it("returns 1 when relevant set is empty", () => {
    expect(recallAtK(["A"], new Set(), 5)).toBe(1);
  });
});

describe("reciprocalRank", () => {
  it("returns 1 when first result is relevant", () => {
    expect(reciprocalRank(["A", "B", "C"], new Set(["A"]))).toBe(1);
  });

  it("returns 1/3 when third result is first relevant", () => {
    expect(reciprocalRank(["X", "Y", "A"], new Set(["A"]))).toBeCloseTo(1 / 3);
  });

  it("returns 0 when no result is relevant", () => {
    expect(reciprocalRank(["X", "Y"], new Set(["A"]))).toBe(0);
  });
});

describe("hitRateAtK", () => {
  it("returns 1 when at least one hit in top-K", () => {
    expect(hitRateAtK(["A", "B", "C"], new Set(["C"]), 3)).toBe(1);
  });

  it("returns 0 when no hit in top-K", () => {
    expect(hitRateAtK(["A", "B", "C"], new Set(["C"]), 2)).toBe(0);
  });
});

describe("aggregateEvalResults", () => {
  it("averages metrics across queries", () => {
    const result = aggregateEvalResults([
      {
        precisionAt5: 0.4,
        precisionAt10: 0.3,
        recallAt10: 0.5,
        rr: 1.0,
        hitRateAt5: 1,
      },
      {
        precisionAt5: 0.2,
        precisionAt10: 0.1,
        recallAt10: 0.3,
        rr: 0.5,
        hitRateAt5: 0,
      },
    ]);
    expect(result.mrr).toBeCloseTo(0.75);
    expect(result.precisionAt5).toBeCloseTo(0.3);
    expect(result.queriesEvaluated).toBe(2);
  });

  it("returns zeros for empty input", () => {
    const result = aggregateEvalResults([]);
    expect(result.mrr).toBe(0);
    expect(result.queriesEvaluated).toBe(0);
  });
});

describe("computeEvalResult", () => {
  it("end-to-end: single query with known hits", () => {
    const retrieved = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const result = computeEvalResult([
      { retrievedIds: retrieved, relevantIds: new Set(["A"]) },
    ]);
    expect(result.mrr).toBe(1);
    expect(result.hitRateAt5).toBe(1);
    expect(result.precisionAt5).toBeCloseTo(1 / 5);
    expect(result.queriesEvaluated).toBe(1);
  });
});
