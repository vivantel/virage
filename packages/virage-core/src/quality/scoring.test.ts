import { describe, it, expect } from "vitest";
import {
  normalizeMonotonicUp01,
  normalizeMonotonicUpSigned,
  normalizeMonotonicDown,
  normalizeIntrinsicDimension,
  normalizeUniformity,
  normalizeCoherence,
  normalizeCalibration,
  aggregateComponent,
  aggregateOverall,
  computeStatus,
} from "./scoring.js";
import type {
  MetricResult,
  ComponentResult,
  MustPassGate,
} from "./interfaces.js";

// ─── normalizeMonotonicUp01 ───────────────────────────────────────────────────

describe("normalizeMonotonicUp01", () => {
  it("returns value as-is for valid [0,1] input", () => {
    expect(normalizeMonotonicUp01(0)).toBe(0);
    expect(normalizeMonotonicUp01(0.5)).toBe(0.5);
    expect(normalizeMonotonicUp01(1)).toBe(1);
  });
  it("clamps values below 0", () => {
    expect(normalizeMonotonicUp01(-0.5)).toBe(0);
  });
  it("clamps values above 1", () => {
    expect(normalizeMonotonicUp01(1.5)).toBe(1);
  });
});

// ─── normalizeMonotonicUpSigned ───────────────────────────────────────────────

describe("normalizeMonotonicUpSigned", () => {
  it("maps -1 to 0, 0 to 0.5, 1 to 1", () => {
    expect(normalizeMonotonicUpSigned(-1)).toBeCloseTo(0);
    expect(normalizeMonotonicUpSigned(0)).toBeCloseTo(0.5);
    expect(normalizeMonotonicUpSigned(1)).toBeCloseTo(1);
  });
  it("clamps outside [-1, 1]", () => {
    expect(normalizeMonotonicUpSigned(-2)).toBe(0);
    expect(normalizeMonotonicUpSigned(2)).toBe(1);
  });
});

// ─── normalizeMonotonicDown ───────────────────────────────────────────────────

describe("normalizeMonotonicDown", () => {
  it("inverts the value", () => {
    expect(normalizeMonotonicDown(0)).toBeCloseTo(1);
    expect(normalizeMonotonicDown(0.3)).toBeCloseTo(0.7);
    expect(normalizeMonotonicDown(1)).toBeCloseTo(0);
  });
  it("clamps", () => {
    expect(normalizeMonotonicDown(-0.1)).toBe(1);
    expect(normalizeMonotonicDown(1.1)).toBe(0);
  });
});

// ─── normalizeIntrinsicDimension ──────────────────────────────────────────────

describe("normalizeIntrinsicDimension", () => {
  it("scores 0 at fraction 0", () => {
    expect(normalizeIntrinsicDimension(0)).toBeCloseTo(0);
  });
  it("reaches 1 at fraction 0.70", () => {
    expect(normalizeIntrinsicDimension(0.7)).toBeCloseTo(1);
  });
  it("stays at 1 in the plateau [0.70, 0.90]", () => {
    expect(normalizeIntrinsicDimension(0.8)).toBeCloseTo(1);
    expect(normalizeIntrinsicDimension(0.9)).toBeCloseTo(1);
  });
  it("drops back to 0 at fraction 1.0", () => {
    expect(normalizeIntrinsicDimension(1.0)).toBeCloseTo(0);
  });
  it("is monotonically increasing up to 0.70", () => {
    const at35 = normalizeIntrinsicDimension(0.35);
    const at50 = normalizeIntrinsicDimension(0.5);
    expect(at35).toBeLessThan(at50);
    expect(at50).toBeLessThan(1);
  });
});

// ─── normalizeUniformity ──────────────────────────────────────────────────────

describe("normalizeUniformity", () => {
  it("scores 0 at 0", () => {
    expect(normalizeUniformity(0)).toBeCloseTo(0);
  });
  it("reaches 1 at 0.70 and stays through 0.85", () => {
    expect(normalizeUniformity(0.7)).toBeCloseTo(1);
    expect(normalizeUniformity(0.775)).toBeCloseTo(1);
    expect(normalizeUniformity(0.85)).toBeCloseTo(1);
  });
  it("drops below 1 above 0.85", () => {
    expect(normalizeUniformity(0.925)).toBeLessThan(1);
  });
});

// ─── normalizeCoherence ───────────────────────────────────────────────────────

describe("normalizeCoherence", () => {
  it("scores 0 at 0", () => {
    expect(normalizeCoherence(0)).toBeCloseTo(0);
  });
  it("reaches 1 at 0.40 and stays through 0.60", () => {
    expect(normalizeCoherence(0.4)).toBeCloseTo(1);
    expect(normalizeCoherence(0.5)).toBeCloseTo(1);
    expect(normalizeCoherence(0.6)).toBeCloseTo(1);
  });
  it("drops below 1 above 0.60", () => {
    expect(normalizeCoherence(0.8)).toBeLessThan(1);
  });
  it("scores 0 at 1.0", () => {
    expect(normalizeCoherence(1.0)).toBeCloseTo(0);
  });
});

// ─── normalizeCalibration ─────────────────────────────────────────────────────

describe("normalizeCalibration", () => {
  it("scores 1 for perfect calibration (mean=0.5, std=0.25)", () => {
    expect(normalizeCalibration(0.5, 0.25)).toBeCloseTo(1);
  });
  it("penalizes mean deviation from 0.5", () => {
    expect(normalizeCalibration(0.0, 0.25)).toBeLessThan(1);
    expect(normalizeCalibration(1.0, 0.25)).toBeLessThan(1);
  });
  it("penalizes std deviation from 0.25", () => {
    expect(normalizeCalibration(0.5, 0.0)).toBeLessThan(1);
    expect(normalizeCalibration(0.5, 0.5)).toBeLessThan(1);
  });
  it("clamps to [0,1]", () => {
    expect(normalizeCalibration(-1, -1)).toBe(0);
  });
});

// ─── aggregateComponent ───────────────────────────────────────────────────────

function makeMetric(
  normalizedValue: number,
  weight: number,
  skipped = false,
): MetricResult {
  return {
    name: "test",
    rawValue: normalizedValue,
    normalizedValue,
    weight,
    skipped,
  };
}

describe("aggregateComponent", () => {
  it("returns weighted average of non-skipped metrics", () => {
    const metrics: MetricResult[] = [makeMetric(0.8, 2), makeMetric(0.4, 2)];
    expect(aggregateComponent(metrics)).toBeCloseTo(0.6);
  });
  it("skips metrics with skipped=true", () => {
    const metrics: MetricResult[] = [
      makeMetric(0.8, 2),
      makeMetric(0.0, 2, true),
    ];
    expect(aggregateComponent(metrics)).toBeCloseTo(0.8);
  });
  it("returns 0 when all metrics are skipped", () => {
    const metrics: MetricResult[] = [makeMetric(0.8, 1, true)];
    expect(aggregateComponent(metrics)).toBe(0);
  });
  it("weights correctly", () => {
    const metrics: MetricResult[] = [makeMetric(1.0, 3), makeMetric(0.0, 1)];
    expect(aggregateComponent(metrics)).toBeCloseTo(0.75);
  });
});

// ─── aggregateOverall ─────────────────────────────────────────────────────────

function makeComponent(
  score: number,
  weight: number,
  skipped = false,
): ComponentResult {
  return {
    id: "chunking",
    label: "test",
    score,
    weight,
    skipped,
    metrics: [],
  };
}

describe("aggregateOverall", () => {
  it("returns weighted average of non-skipped components", () => {
    const components: ComponentResult[] = [
      makeComponent(0.9, 1),
      makeComponent(0.5, 1),
    ];
    expect(aggregateOverall(components)).toBeCloseTo(0.7);
  });
  it("skips skipped components", () => {
    const components: ComponentResult[] = [
      makeComponent(0.9, 1),
      makeComponent(0.0, 1, true),
    ];
    expect(aggregateOverall(components)).toBeCloseTo(0.9);
  });
});

// ─── computeStatus ───────────────────────────────────────────────────────────

function makeGate(passed: boolean): MustPassGate {
  return {
    metricName: "Test",
    threshold: 0.8,
    value: passed ? 0.9 : 0.5,
    passed,
  };
}

describe("computeStatus", () => {
  it("returns PASS when overall >= 0.70 and all gates pass", () => {
    expect(computeStatus(0.75, [makeGate(true), makeGate(true)])).toBe("PASS");
  });
  it("returns FAIL when overall < 0.70", () => {
    expect(computeStatus(0.65, [makeGate(true)])).toBe("FAIL");
  });
  it("returns FAIL when any gate fails", () => {
    expect(computeStatus(0.85, [makeGate(true), makeGate(false)])).toBe("FAIL");
  });
  it("returns PASS with no gates and score >= 0.70", () => {
    expect(computeStatus(0.7, [])).toBe("PASS");
  });
  it("returns FAIL with no gates and score < 0.70", () => {
    expect(computeStatus(0.69, [])).toBe("FAIL");
  });
});
