/**
 * Pure embedding quality metric functions.
 * No I/O, no external dependencies.
 */

import type { EmbeddingMetrics } from "@vivantel/virage-core";

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * TWO-NN intrinsic dimension estimator.
 * For each point, computes r1/r2 (ratio of distances to 1st and 2nd
 * nearest neighbours). ID = -1 / mean(ln(r1/r2)).
 * Reference: Facco et al. (2017).
 */
export function computeIntrinsicDimension(embeddings: number[][]): number {
  const n = embeddings.length;
  if (n < 3) return embeddings[0]?.length ?? 0;

  const l2sq = (a: number[], b: number[]): number => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
    return s;
  };

  let sumLn = 0;
  let count = 0;

  for (let i = 0; i < n; i++) {
    let d1 = Infinity;
    let d2 = Infinity;

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = l2sq(embeddings[i], embeddings[j]);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }

    if (d1 > 0 && d2 > 0 && d1 < d2) {
      sumLn += Math.log(Math.sqrt(d1) / Math.sqrt(d2));
      count++;
    }
  }

  if (count === 0) return embeddings[0]?.length ?? 0;
  return -count / sumLn;
}

/**
 * Mean cosine similarity between randomly sampled pairs.
 * Close to 0 is ideal (well-spread embedding space).
 */
export function computeAvgCosineSimRandomPairs(
  embeddings: number[][],
  sampleSize = 500,
): number {
  const n = embeddings.length;
  if (n < 2) return 0;

  const pairs = Math.min(sampleSize, (n * (n - 1)) / 2);
  let sum = 0;

  for (let i = 0; i < pairs; i++) {
    const a = Math.floor(Math.random() * n);
    let b = Math.floor(Math.random() * (n - 1));
    if (b >= a) b++;
    sum += cosineSimilarity(embeddings[a], embeddings[b]);
  }

  return sum / pairs;
}

/**
 * Fraction of embeddings whose L2-norm z-score exceeds 2.5.
 */
export function detectOutliers(embeddings: number[][]): number {
  if (embeddings.length < 2) return 0;

  const norms = embeddings.map((e) =>
    Math.sqrt(e.reduce((s, v) => s + v * v, 0)),
  );
  const mean = norms.reduce((s, v) => s + v, 0) / norms.length;
  const variance =
    norms.reduce((s, v) => s + (v - mean) ** 2, 0) / norms.length;
  const std = Math.sqrt(variance);

  if (std === 0) return 0;

  const outliers = norms.filter((n) => Math.abs(n - mean) / std > 2.5).length;
  return outliers / norms.length;
}

export async function computeEmbeddingMetrics(
  embeddings: number[][],
): Promise<EmbeddingMetrics> {
  return {
    intrinsicDimension: computeIntrinsicDimension(embeddings),
    avgCosineSimRandomPairs: computeAvgCosineSimRandomPairs(embeddings),
    outlierFraction: detectOutliers(embeddings),
  };
}
