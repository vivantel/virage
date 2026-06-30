/**
 * Component 7 — Reranker Input Construction metrics (4 metrics) [optional]
 *
 * Feature Completeness:   fraction of expected features present and non-null.
 * Feature Ablation Impact: per-feature ΔUplift when removed.
 * Feature Redundancy:     mean pairwise correlation between features.
 * Input Consistency:      fraction of inputs where features share the same chunk ID.
 *
 * Skipped entirely when no reranker is configured.
 */

import type { MetricResult } from "../interfaces.js";
import { normalizeMonotonicUp01, normalizeMonotonicDown } from "../scoring.js";

export interface RerankerInputSample {
  chunkId: string;
  denseVector: number[] | null;
  sparseScore: number | null;
  metadata: Record<string, unknown> | null;
  sourceChunkId?: string;
}

export interface RerankerInputMetricsInput {
  samples: RerankerInputSample[];
  rerankerAvailable: boolean;
}

const EXPECTED_FEATURES = ["denseVector", "sparseScore", "metadata"] as const;

export function computeRerankerInputMetrics(
  input: RerankerInputMetricsInput,
  weightOverrides: Partial<Record<string, number>> = {},
): MetricResult[] {
  const { samples, rerankerAvailable } = input;

  const skipped = !rerankerAvailable || samples.length === 0;
  const skipReason = !rerankerAvailable
    ? "No reranker configured"
    : "No reranker input samples";

  if (skipped) {
    const defs = [
      { key: "featureCompleteness", weight: 1.0, name: "FeatureCompleteness" },
      { key: "featureAblation", weight: 1.0, name: "FeatureAblationImpact" },
      { key: "featureRedundancy", weight: 0.5, name: "FeatureRedundancy" },
      { key: "inputConsistency", weight: 1.0, name: "InputConsistency" },
    ] as const;
    return defs.map(
      ({ key, weight, name }): MetricResult => ({
        name,
        rawValue: 0,
        normalizedValue: 0,
        weight: weightOverrides[key] ?? weight,
        skipped: true,
        skipReason,
      }),
    );
  }

  // Feature Completeness
  let presentCount = 0;
  let totalCount = 0;
  for (const s of samples) {
    for (const f of EXPECTED_FEATURES) {
      totalCount++;
      if (s[f] != null) presentCount++;
    }
  }
  const featureCompleteness = totalCount === 0 ? 0 : presentCount / totalCount;

  // Feature Ablation Impact: proxy — feature standard deviation (higher std = more discriminative)
  // True ablation requires running reranker twice per feature which is expensive.
  // We approximate: ablation ~ std(feature values) / mean(std of all features).
  const featureStds: Record<string, number> = {};
  for (const f of ["sparseScore"] as const) {
    const vals = samples.map((s) => s[f] ?? 0);
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std = Math.sqrt(
      vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length,
    );
    featureStds[f] = std;
  }
  const denseStd = samples.map(
    (s) => s.denseVector?.reduce((s, v) => s + Math.abs(v), 0) ?? 0,
  );
  const denseAvg = denseStd.reduce((s, v) => s + v, 0) / denseStd.length;
  const denseStdVal = Math.sqrt(
    denseStd.reduce((s, v) => s + (v - denseAvg) ** 2, 0) / denseStd.length,
  );
  featureStds["denseVector"] = denseStdVal;

  const allStds = Object.values(featureStds);
  const maxStd = Math.max(...allStds);
  const featureAblation = maxStd === 0 ? 0 : Math.min(...allStds) / maxStd;

  // Feature Redundancy: pairwise correlation between sparseScore and dense L2 norm
  const sparseVals = samples.map((s) => s.sparseScore ?? 0);
  const denseNorms = samples.map((s) =>
    s.denseVector ? Math.sqrt(s.denseVector.reduce((a, v) => a + v * v, 0)) : 0,
  );
  const sparseAvg = sparseVals.reduce((s, v) => s + v, 0) / sparseVals.length;
  const denseNormAvg =
    denseNorms.reduce((s, v) => s + v, 0) / denseNorms.length;
  const cov =
    sparseVals.reduce(
      (s, v, i) => s + (v - sparseAvg) * (denseNorms[i] - denseNormAvg),
      0,
    ) / sparseVals.length;
  const sparseStdR = Math.sqrt(
    sparseVals.reduce((s, v) => s + (v - sparseAvg) ** 2, 0) /
      sparseVals.length,
  );
  const denseNormStd = Math.sqrt(
    denseNorms.reduce((s, v) => s + (v - denseNormAvg) ** 2, 0) /
      denseNorms.length,
  );
  const featureRedundancy =
    sparseStdR === 0 || denseNormStd === 0
      ? 0
      : Math.abs(cov / (sparseStdR * denseNormStd));

  // Input Consistency
  const consistent = samples.filter(
    (s) => !s.sourceChunkId || s.sourceChunkId === s.chunkId,
  );
  const inputConsistency =
    samples.length === 0 ? 0 : consistent.length / samples.length;

  return [
    {
      name: "FeatureCompleteness",
      rawValue: featureCompleteness,
      normalizedValue: normalizeMonotonicUp01(featureCompleteness),
      weight: weightOverrides["featureCompleteness"] ?? 1.0,
      skipped: false,
    },
    {
      name: "FeatureAblationImpact",
      rawValue: featureAblation,
      normalizedValue: normalizeMonotonicUp01(featureAblation),
      weight: weightOverrides["featureAblation"] ?? 1.0,
      skipped: false,
    },
    {
      name: "FeatureRedundancy",
      rawValue: featureRedundancy,
      normalizedValue: normalizeMonotonicDown(featureRedundancy),
      weight: weightOverrides["featureRedundancy"] ?? 0.5,
      skipped: false,
    },
    {
      name: "InputConsistency",
      rawValue: inputConsistency,
      normalizedValue: normalizeMonotonicUp01(inputConsistency),
      weight: weightOverrides["inputConsistency"] ?? 1.0,
      skipped: false,
    },
  ];
}
