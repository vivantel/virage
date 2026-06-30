/**
 * Component 4 — Dense Embedding metrics (5 metrics)
 *
 * Self-Recall@K:      chunk-as-query retrieval hit rate (must-pass >0.80).
 * Intrinsic Dimension: PCA components to explain 95% variance (target 70–90% of dims).
 * Uniformity:         kd-tree kth-nearest distance evenness (target 0.7–0.85).
 * Isotropy:           min/max eigenvalue ratio of covariance matrix.
 * Outlier Fraction:   fraction with no close neighbours (must-pass <0.05).
 */

import type { MetricResult } from "../interfaces.js";
import {
  normalizeMonotonicUp01,
  normalizeMonotonicDown,
  normalizeIntrinsicDimension,
  normalizeUniformity,
} from "../scoring.js";

export interface DenseEmbeddingMetricsInput {
  chunks: Array<{ id: string; denseText: string; anchorText?: string }>;
  searchFn: (query: string, topK: number) => Promise<Array<{ id: string }>>;
  embedFn: (text: string) => Promise<number[]>;
  topK: number;
}

// ─── Self-Recall@K ─────────────────────────────────────────────────────────────

async function computeSelfRecall(
  chunks: DenseEmbeddingMetricsInput["chunks"],
  searchFn: DenseEmbeddingMetricsInput["searchFn"],
  topK: number,
): Promise<number> {
  if (chunks.length === 0) return 0;
  let hits = 0;
  for (const chunk of chunks) {
    const query = chunk.anchorText ?? chunk.denseText.slice(0, 80);
    const results = await searchFn(query, topK);
    if (results.some((r) => r.id === chunk.id)) hits++;
  }
  return hits / chunks.length;
}

// ─── PCA helpers (no dependency on external libs) ─────────────────────────────

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Power iteration to find the largest eigenvector/eigenvalue of a symmetric matrix.
 * Returns [eigenvalue, eigenvector].
 */
function powerIteration(M: number[][], maxIter = 100): [number, number[]] {
  const n = M.length;
  let v = Array.from({ length: n }, () => Math.random() - 0.5);
  let lambda = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    const Mv = M.map((row) => row.reduce((s, val, j) => s + val * v[j], 0));
    lambda = Math.sqrt(Mv.reduce((s, x) => s + x * x, 0));
    if (lambda < 1e-10) break;
    v = Mv.map((x) => x / lambda);
  }
  return [lambda, v];
}

/**
 * Lightweight PCA: uses repeated power iteration with deflation.
 * Returns explained variance fractions for each component.
 * Suitable for sampleSize <= 500, dims <= 1024.
 */
function pca(matrix: number[][], numComponents: number): number[] {
  const n = matrix.length;
  const d = matrix[0].length;
  const k = Math.min(numComponents, d, n - 1);

  const colMeans = Array.from({ length: d }, (_, j) =>
    mean(matrix.map((row) => row[j])),
  );
  const centered = matrix.map((row) => row.map((v, j) => v - colMeans[j]));

  // Covariance matrix (d × d)
  const cov: number[][] = Array.from({ length: d }, () => Array(d).fill(0));
  for (const row of centered) {
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        cov[i][j] += (row[i] * row[j]) / n;
      }
    }
  }

  const eigenvalues: number[] = [];
  const residual = cov.map((r) => [...r]);

  for (let c = 0; c < k; c++) {
    const [lambda, v] = powerIteration(residual);
    eigenvalues.push(lambda);
    // Deflate: residual = residual - lambda * v * v^T
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        residual[i][j] -= lambda * v[i] * v[j];
      }
    }
  }

  const totalVar = eigenvalues.reduce((s, e) => s + e, 0);
  if (totalVar === 0) return eigenvalues.map(() => 0);
  return eigenvalues.map((e) => e / totalVar);
}

function computeIntrinsicDimension(vectors: number[][]): {
  fraction: number;
  components95: number;
  totalDims: number;
} {
  if (vectors.length < 4) {
    return { fraction: 0, components95: 0, totalDims: vectors[0]?.length ?? 0 };
  }
  const totalDims = vectors[0].length;
  const maxComponents = Math.min(totalDims, vectors.length - 1, 64);
  const variances = pca(vectors, maxComponents);
  let cumVar = 0;
  let components95 = maxComponents;
  for (let i = 0; i < variances.length; i++) {
    cumVar += variances[i];
    if (cumVar >= 0.95) {
      components95 = i + 1;
      break;
    }
  }
  return {
    fraction: components95 / totalDims,
    components95,
    totalDims,
  };
}

// ─── Uniformity (kth-nearest-distance evenness) ───────────────────────────────

function l2(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}

function computeUniformity(vectors: number[][], k = 5): number {
  if (vectors.length < k + 1) return 0;
  const kthDistances = vectors.map((v) => {
    const dists = vectors
      .filter((u) => u !== v)
      .map((u) => l2(v, u))
      .sort((a, b) => a - b);
    return dists[k - 1] ?? 0;
  });
  const avg = mean(kthDistances);
  const stdDev = Math.sqrt(mean(kthDistances.map((d) => (d - avg) ** 2)));
  if (avg === 0) return 0;
  return Math.max(0, Math.min(1, 1 - stdDev / avg));
}

// ─── Isotropy (min/max eigenvalue ratio) ─────────────────────────────────────

function computeIsotropy(vectors: number[][]): number {
  if (vectors.length < 4) return 0;
  const d = vectors[0].length;
  const n = vectors.length;
  const colMeans = Array.from({ length: d }, (_, j) =>
    mean(vectors.map((row) => row[j])),
  );
  const centered = vectors.map((row) => row.map((v, j) => v - colMeans[j]));
  const cov: number[][] = Array.from({ length: d }, () => Array(d).fill(0));
  for (const row of centered) {
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        cov[i][j] += (row[i] * row[j]) / n;
      }
    }
  }

  const maxComponents = Math.min(d, n - 1, 32);
  const variances: number[] = [];
  const residual = cov.map((r) => [...r]);
  for (let c = 0; c < maxComponents; c++) {
    const [lambda] = powerIteration(residual);
    variances.push(lambda);
    const [, v] = powerIteration(residual);
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        residual[i][j] -= lambda * v[i] * v[j];
      }
    }
  }

  if (variances.length < 2) return 0;
  const maxEig = Math.max(...variances);
  const minEig = Math.min(...variances.filter((v) => v > 1e-10));
  return maxEig === 0 ? 0 : Math.min(1, minEig / maxEig);
}

// ─── Outlier Fraction ─────────────────────────────────────────────────────────

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeOutlierFraction(vectors: number[][]): number {
  if (vectors.length < 4) return 0;
  const nearestDists = vectors.map((v) => {
    const dists = vectors.filter((u) => u !== v).map((u) => l2(v, u));
    return Math.min(...dists);
  });
  const sorted = [...nearestDists].sort((a, b) => a - b);
  const med = median(sorted);
  const mad = median(
    sorted.map((d) => Math.abs(d - med)).sort((a, b) => a - b),
  );
  const threshold = med + 3 * mad;
  const outliers = nearestDists.filter((d) => d > threshold);
  return outliers.length / vectors.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function computeDenseEmbeddingMetrics(
  input: DenseEmbeddingMetricsInput,
  sampleSize = 200,
  selfRecallThreshold = 0.8,
  outlierThreshold = 0.05,
  weightOverrides: Partial<Record<string, number>> = {},
): Promise<MetricResult[]> {
  const { chunks, searchFn, embedFn, topK } = input;
  const sample = chunks.slice(0, sampleSize);

  // Self-Recall (must pass >0.80)
  const selfRecall = await computeSelfRecall(sample, searchFn, topK);

  // Embed the sample for geometry metrics
  const vectors = await Promise.all(sample.map((c) => embedFn(c.denseText)));

  const { fraction: idFraction } = computeIntrinsicDimension(vectors);
  const uniformity = computeUniformity(vectors);
  const isotropy = computeIsotropy(vectors);
  const outlierFraction = computeOutlierFraction(vectors);

  return [
    {
      name: "SelfRecall@K",
      rawValue: selfRecall,
      normalizedValue: normalizeMonotonicUp01(selfRecall),
      weight: weightOverrides["selfRecall"] ?? 3.0,
      skipped: false,
      mustPass: true,
      mustPassThreshold: selfRecallThreshold,
      mustPassPassed: selfRecall > selfRecallThreshold,
    },
    {
      name: "IntrinsicDimension",
      rawValue: idFraction,
      normalizedValue: normalizeIntrinsicDimension(idFraction),
      weight: weightOverrides["intrinsicDimension"] ?? 1.0,
      skipped: vectors.length < 4,
      skipReason:
        vectors.length < 4 ? "Insufficient sample for PCA" : undefined,
    },
    {
      name: "Uniformity",
      rawValue: uniformity,
      normalizedValue: normalizeUniformity(uniformity),
      weight: weightOverrides["uniformity"] ?? 1.0,
      skipped: vectors.length < 4,
      skipReason: vectors.length < 4 ? "Insufficient sample" : undefined,
    },
    {
      name: "Isotropy",
      rawValue: isotropy,
      normalizedValue: normalizeMonotonicUp01(isotropy),
      weight: weightOverrides["isotropy"] ?? 0.5,
      skipped: vectors.length < 4,
      skipReason: vectors.length < 4 ? "Insufficient sample" : undefined,
    },
    {
      name: "OutlierFraction",
      rawValue: outlierFraction,
      normalizedValue: normalizeMonotonicDown(outlierFraction),
      weight: weightOverrides["outlierFraction"] ?? 1.0,
      skipped: vectors.length < 4,
      skipReason: vectors.length < 4 ? "Insufficient sample" : undefined,
      mustPass: true,
      mustPassThreshold: outlierThreshold,
      mustPassPassed: outlierFraction < outlierThreshold,
    },
  ];
}
