/**
 * Component 8 — Reranker metrics (3 metrics) [optional]
 *
 * Uplift:          ΔMRR vs dense-only baseline.
 * Calibration:     score distribution quality (target mean ~0.5, std ~0.25).
 * Confidence Gap:  mean(top-5) - mean(scores[5:25]).
 *
 * Skipped when no reranker is configured.
 */

import type { MetricResult } from "../interfaces.js";
import { normalizeMonotonicUp01, normalizeCalibration } from "../scoring.js";

export interface RerankerMetricsInput {
  rerankerMrr: number | null;
  baselineMrr: number | null;
  rerankerScores: number[];
  rerankerAvailable: boolean;
}

export function computeRerankerMetrics(
  input: RerankerMetricsInput,
  weightOverrides: Partial<Record<string, number>> = {},
): MetricResult[] {
  const { rerankerMrr, baselineMrr, rerankerScores, rerankerAvailable } = input;

  if (!rerankerAvailable || rerankerMrr == null) {
    const skipReason = !rerankerAvailable
      ? "No reranker configured"
      : "Reranker MRR not available";
    return [
      {
        name: "Uplift",
        rawValue: 0,
        normalizedValue: 0,
        weight: weightOverrides["uplift"] ?? 2.5,
        skipped: true,
        skipReason,
      },
      {
        name: "Calibration",
        rawValue: 0,
        normalizedValue: 0,
        weight: weightOverrides["calibration"] ?? 1.0,
        skipped: true,
        skipReason,
      },
      {
        name: "ConfidenceGap",
        rawValue: 0,
        normalizedValue: 0,
        weight: weightOverrides["confidenceGap"] ?? 0.5,
        skipped: true,
        skipReason,
      },
    ];
  }

  // Uplift: ΔMRR vs baseline (clamped to [0, 1])
  const baseline = baselineMrr ?? 0;
  const upliftRaw = rerankerMrr - baseline;
  const upliftNormalized = normalizeMonotonicUp01(Math.max(0, upliftRaw));

  // Calibration: target mean ~0.5, std ~0.25
  let calibrationRaw = 0;
  if (rerankerScores.length > 0) {
    const mean =
      rerankerScores.reduce((s, v) => s + v, 0) / rerankerScores.length;
    const std = Math.sqrt(
      rerankerScores.reduce((s, v) => s + (v - mean) ** 2, 0) /
        rerankerScores.length,
    );
    calibrationRaw = normalizeCalibration(mean, std);
  }

  // Confidence Gap: mean(top-5) - mean(scores[5:25])
  let confidenceGapRaw = 0;
  if (rerankerScores.length > 5) {
    const sorted = [...rerankerScores].sort((a, b) => b - a);
    const top5 = sorted.slice(0, 5);
    const next20 = sorted.slice(5, 25);
    const top5Mean = top5.reduce((s, v) => s + v, 0) / top5.length;
    const next20Mean =
      next20.length > 0 ? next20.reduce((s, v) => s + v, 0) / next20.length : 0;
    confidenceGapRaw = Math.max(0, top5Mean - next20Mean);
  }

  return [
    {
      name: "Uplift",
      rawValue: upliftRaw,
      normalizedValue: upliftNormalized,
      weight: weightOverrides["uplift"] ?? 2.5,
      skipped: false,
    },
    {
      name: "Calibration",
      rawValue: calibrationRaw,
      normalizedValue: calibrationRaw,
      weight: weightOverrides["calibration"] ?? 1.0,
      skipped: false,
    },
    {
      name: "ConfidenceGap",
      rawValue: confidenceGapRaw,
      normalizedValue: normalizeMonotonicUp01(confidenceGapRaw),
      weight: weightOverrides["confidenceGap"] ?? 0.5,
      skipped: false,
    },
  ];
}
