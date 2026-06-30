import type {
  MetricResult,
  ComponentResult,
  MustPassGate,
  QualityStatus,
} from "./interfaces.js";

// ─── Normalization ─────────────────────────────────────────────────────────────

/** Monotonic ↑, native [0, 1] — identity. */
export function normalizeMonotonicUp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Monotonic ↑, native [-1, 1] — shift to [0, 1]. */
export function normalizeMonotonicUpSigned(v: number): number {
  return Math.max(0, Math.min(1, (v + 1) / 2));
}

/** Monotonic ↓, native [0, 1] — flip. */
export function normalizeMonotonicDown(v: number): number {
  return Math.max(0, Math.min(1, 1 - v));
}

/**
 * Non-monotonic: Intrinsic Dimension target is 70%–90% of total dims.
 * Input is the fraction (0–1) of total dims that explains 95% variance.
 */
export function normalizeIntrinsicDimension(fraction: number): number {
  if (fraction <= 0) return 0;
  if (fraction < 0.7) return fraction / 0.7;
  if (fraction <= 0.9) return 1;
  if (fraction < 1.0) return (1.0 - fraction) / 0.1;
  return 0;
}

/**
 * Non-monotonic: Uniformity target is 0.7–0.85.
 */
export function normalizeUniformity(v: number): number {
  if (v <= 0) return 0;
  if (v < 0.7) return v / 0.7;
  if (v <= 0.85) return 1;
  if (v < 1.0) return (1.0 - v) / 0.15;
  return 0;
}

/**
 * Non-monotonic: Coherence target is 0.4–0.6 (cosine similarity between adjacent chunks).
 * Input raw cosine value in [-1, 1].
 */
export function normalizeCoherence(v: number): number {
  if (v < 0) return 0;
  if (v < 0.4) return v / 0.4;
  if (v <= 0.6) return 1;
  if (v < 1.0) return (1.0 - v) / 0.4;
  return 0;
}

/**
 * Non-monotonic: Calibration target mean ~0.5, std ~0.25.
 * Formula: 1 - |mean - 0.5| - |std - 0.25|, clamped to [0, 1].
 */
export function normalizeCalibration(mean: number, std: number): number {
  return Math.max(
    0,
    Math.min(1, 1 - Math.abs(mean - 0.5) - Math.abs(std - 0.25)),
  );
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

/** Weighted average of normalized metric values, excluding skipped metrics. */
export function aggregateComponent(metrics: MetricResult[]): number {
  const active = metrics.filter((m) => !m.skipped);
  if (active.length === 0) return 0;
  const weightedSum = active.reduce(
    (s, m) => s + m.normalizedValue * m.weight,
    0,
  );
  const totalWeight = active.reduce((s, m) => s + m.weight, 0);
  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

/** Weighted average of component scores, excluding skipped components. */
export function aggregateOverall(components: ComponentResult[]): number {
  const active = components.filter((c) => !c.skipped);
  if (active.length === 0) return 0;
  const weightedSum = active.reduce((s, c) => s + c.score * c.weight, 0);
  const totalWeight = active.reduce((s, c) => s + c.weight, 0);
  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

// ─── Must-pass gate evaluation ────────────────────────────────────────────────

export function evaluateMustPassGates(gates: MustPassGate[]): QualityStatus {
  const anyFailed = gates.some((g) => !g.passed);
  return anyFailed ? "FAIL" : "PASS";
}

/** Returns PASS only when overall >= 0.70 AND all must-pass gates passed. */
export function computeStatus(
  overall: number,
  gates: MustPassGate[],
): QualityStatus {
  if (overall < 0.7) return "FAIL";
  return evaluateMustPassGates(gates);
}
