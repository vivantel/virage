/**
 * Component 1 — Chunking metrics (4 metrics)
 *
 * Cohesion:  mean cosine similarity between sentence embeddings within a chunk.
 * Integrity: fraction of AST/structural nodes fully contained within chunk boundaries.
 * Coherence: cosine similarity between adjacent chunks (non-monotonic target 0.4–0.6).
 * Coverage:  fraction of chunks whose token count falls within [min, max] range.
 *
 * Note: Integrity requires parsed AST node boundaries in chunk metadata.
 * Cohesion/Coherence require an embedder for sentence-level vectors.
 * When AST metadata is absent, Integrity is skipped.
 */

import type { MetricResult } from "../interfaces.js";
import { normalizeMonotonicUp01, normalizeCoherence } from "../scoring.js";

export interface ChunkMetricsInput {
  chunks: Array<{
    denseText: string;
    sparseText?: string;
    metadata?: {
      astNodeCount?: number;
      astNodeCountInBounds?: number;
      tokenCount?: number;
    };
  }>;
  embedFn: (text: string) => Promise<number[]>;
  tokenRangeMin?: number;
  tokenRangeMax?: number;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function splitSentences(text: string): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) ?? [];
  return sentences.map((s) => s.trim()).filter((s) => s.length > 10);
}

/** Cohesion: mean pairwise cosine similarity between sentence embeddings within a chunk. */
async function computeCohesion(
  chunks: ChunkMetricsInput["chunks"],
  embedFn: (text: string) => Promise<number[]>,
  sampleSize: number,
): Promise<number> {
  const sample = chunks.slice(0, sampleSize);
  const cohesions: number[] = [];

  for (const chunk of sample) {
    const sentences = splitSentences(chunk.denseText);
    if (sentences.length < 2) continue;

    const embeds = await Promise.all(sentences.map((s) => embedFn(s)));
    let pairSum = 0;
    let pairCount = 0;
    for (let i = 0; i < embeds.length; i++) {
      for (let j = i + 1; j < embeds.length; j++) {
        pairSum += cosineSim(embeds[i], embeds[j]);
        pairCount++;
      }
    }
    if (pairCount > 0) cohesions.push(pairSum / pairCount);
  }

  return cohesions.length === 0
    ? 0
    : cohesions.reduce((s, v) => s + v, 0) / cohesions.length;
}

/** Integrity: fraction of AST nodes fully contained within chunk boundaries (from metadata). */
function computeIntegrity(chunks: ChunkMetricsInput["chunks"]): number | null {
  let totalNodes = 0;
  let boundedNodes = 0;
  for (const chunk of chunks) {
    const total = chunk.metadata?.astNodeCount;
    const bounded = chunk.metadata?.astNodeCountInBounds;
    if (total != null && bounded != null) {
      totalNodes += total;
      boundedNodes += bounded;
    }
  }
  if (totalNodes === 0) return null;
  return boundedNodes / totalNodes;
}

/** Coherence: mean cosine similarity between adjacent chunk embeddings. */
async function computeCoherence(
  chunks: ChunkMetricsInput["chunks"],
  embedFn: (text: string) => Promise<number[]>,
  sampleSize: number,
): Promise<number> {
  if (chunks.length < 2) return 0.5;
  const sample = chunks.slice(0, sampleSize + 1);
  const embeds = await Promise.all(sample.map((c) => embedFn(c.denseText)));
  const sims: number[] = [];
  for (let i = 0; i < embeds.length - 1; i++) {
    sims.push(cosineSim(embeds[i], embeds[i + 1]));
  }
  return sims.reduce((s, v) => s + v, 0) / sims.length;
}

/** Coverage: fraction of chunks whose token count is within [min, max]. */
function computeCoverage(
  chunks: ChunkMetricsInput["chunks"],
  minTokens: number,
  maxTokens: number,
): number {
  if (chunks.length === 0) return 0;
  const inRange = chunks.filter((c) => {
    const tokenCount =
      c.metadata?.tokenCount ?? Math.round(c.denseText.split(/\s+/).length);
    return tokenCount >= minTokens && tokenCount <= maxTokens;
  });
  return inRange.length / chunks.length;
}

export async function computeChunkingMetrics(
  input: ChunkMetricsInput,
  sampleSize = 100,
  weightOverrides: Partial<Record<string, number>> = {},
): Promise<MetricResult[]> {
  const { chunks, embedFn, tokenRangeMin = 50, tokenRangeMax = 512 } = input;
  const sample = chunks.slice(0, sampleSize);

  const [cohesionRaw, coherenceRaw] = await Promise.all([
    computeCohesion(sample, embedFn, sampleSize),
    computeCoherence(sample, embedFn, sampleSize),
  ]);

  const integrityRaw = computeIntegrity(chunks);
  const coverageRaw = computeCoverage(chunks, tokenRangeMin, tokenRangeMax);

  const results: MetricResult[] = [
    {
      name: "Cohesion",
      rawValue: cohesionRaw,
      normalizedValue: normalizeMonotonicUp01((cohesionRaw + 1) / 2),
      weight: weightOverrides["cohesion"] ?? 2.0,
      skipped: false,
    },
    {
      name: "Integrity",
      rawValue: integrityRaw ?? 0,
      normalizedValue:
        integrityRaw != null ? normalizeMonotonicUp01(integrityRaw) : 0,
      weight: weightOverrides["integrity"] ?? 2.0,
      skipped: integrityRaw == null,
      skipReason:
        integrityRaw == null
          ? "AST node boundary metadata not present in chunks"
          : undefined,
    },
    {
      name: "Coherence",
      rawValue: coherenceRaw,
      normalizedValue: normalizeCoherence(coherenceRaw),
      weight: weightOverrides["coherence"] ?? 0.5,
      skipped: false,
    },
    {
      name: "Coverage",
      rawValue: coverageRaw,
      normalizedValue: normalizeMonotonicUp01(coverageRaw),
      weight: weightOverrides["coverage"] ?? 1.0,
      skipped: false,
    },
  ];

  return results;
}
