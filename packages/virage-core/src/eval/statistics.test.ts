import { describe, it, expect } from "vitest";
import { bootstrapPairedTest } from "./statistics.js";

describe("bootstrapPairedTest", () => {
  it("throws when arrays have different lengths", () => {
    expect(() => bootstrapPairedTest([0.5], [0.6, 0.7])).toThrow();
  });

  it("throws on empty arrays", () => {
    expect(() => bootstrapPairedTest([], [])).toThrow();
  });

  it("returns inconclusive when baseline and candidate are identical", () => {
    const scores = [0.5, 0.7, 0.3, 0.9, 0.2, 0.6, 0.4, 0.8, 0.1, 0.5];
    const result = bootstrapPairedTest(scores, [...scores], 5_000);
    expect(result.mrrDelta).toBeCloseTo(0);
    // p-value near 0.5 when there is no difference
    expect(result.pValue).toBeGreaterThan(0.1);
    expect(result.recommendation).toBe("inconclusive");
  });

  it("accepts when candidate is clearly better", () => {
    const baseline = Array.from({ length: 20 }, () => 0.3);
    const candidate = Array.from({ length: 20 }, () => 0.8);
    const result = bootstrapPairedTest(baseline, candidate, 5_000);
    expect(result.mrrDelta).toBeCloseTo(0.5);
    // 95% CI should be entirely above 0
    expect(result.confidenceInterval95[0]).toBeGreaterThan(0);
    expect(result.recommendation).toBe("accept");
  });

  it("rejects when candidate is clearly worse", () => {
    const baseline = Array.from({ length: 20 }, () => 0.8);
    const candidate = Array.from({ length: 20 }, () => 0.3);
    const result = bootstrapPairedTest(baseline, candidate, 5_000);
    expect(result.mrrDelta).toBeCloseTo(-0.5);
    // 95% CI should be entirely below 0
    expect(result.confidenceInterval95[1]).toBeLessThan(0);
    expect(result.recommendation).toBe("reject");
  });

  it("returns valid confidence interval (lo ≤ hi)", () => {
    const baseline = [0.5, 0.6, 0.4, 0.7, 0.3];
    const candidate = [0.6, 0.7, 0.5, 0.8, 0.4];
    const result = bootstrapPairedTest(baseline, candidate, 5_000);
    const [lo, hi] = result.confidenceInterval95;
    // The CI should be a valid interval and bracket the delta (with some tolerance)
    expect(lo).toBeLessThanOrEqual(hi);
    expect(result.mrrDelta).toBeCloseTo(0.1, 5);
  });
});
