/**
 * Component 5 — Sparse Input Preparation metrics (2 metrics) [optional]
 *
 * Term Coverage: fraction of unique terms from chunk surviving preprocessing.
 * Term Sparsity: fraction of terms with zero doc frequency in corpus.
 *
 * Skipped entirely when no sparse store is configured.
 */

import type { MetricResult } from "../interfaces.js";
import { normalizeMonotonicUp01, normalizeMonotonicDown } from "../scoring.js";

export interface SparseInputMetricsInput {
  chunks: Array<{ sparseText: string }>;
  corpusTermFreqs?: Map<string, number>;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "it",
  "this",
  "that",
  "be",
  "as",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter((t) => t.length > 2);
}

function preprocessTerms(tokens: string[]): string[] {
  return tokens.filter((t) => !STOP_WORDS.has(t));
}

export function computeSparseInputMetrics(
  input: SparseInputMetricsInput,
  weightOverrides: Partial<Record<string, number>> = {},
): MetricResult[] {
  const { chunks, corpusTermFreqs } = input;
  if (chunks.length === 0 || chunks.every((c) => !c.sparseText)) {
    return [
      {
        name: "TermCoverage",
        rawValue: 0,
        normalizedValue: 0,
        weight: weightOverrides["termCoverage"] ?? 1.0,
        skipped: true,
        skipReason: "No sparseText found in sampled chunks",
      },
      {
        name: "TermSparsity",
        rawValue: 0,
        normalizedValue: 0,
        weight: weightOverrides["termSparsity"] ?? 0.5,
        skipped: true,
        skipReason: "No sparseText found in sampled chunks",
      },
    ];
  }

  // Term Coverage
  const coverageScores: number[] = [];
  for (const { sparseText } of chunks) {
    if (!sparseText) continue;
    const raw = tokenize(sparseText);
    const unique = new Set(raw);
    const surviving = preprocessTerms([...unique]);
    coverageScores.push(unique.size === 0 ? 0 : surviving.length / unique.size);
  }
  const termCoverage =
    coverageScores.length === 0
      ? 0
      : coverageScores.reduce((s, v) => s + v, 0) / coverageScores.length;

  // Term Sparsity
  let termSparsity = 0;
  if (corpusTermFreqs && corpusTermFreqs.size > 0) {
    const allTerms: string[] = [];
    for (const { sparseText } of chunks) {
      if (sparseText) allTerms.push(...tokenize(sparseText));
    }
    const uniqueTerms = new Set(allTerms);
    const zeroFreq = [...uniqueTerms].filter(
      (t) => !corpusTermFreqs.has(t) || corpusTermFreqs.get(t) === 0,
    );
    termSparsity =
      uniqueTerms.size === 0 ? 0 : zeroFreq.length / uniqueTerms.size;
  }

  return [
    {
      name: "TermCoverage",
      rawValue: termCoverage,
      normalizedValue: normalizeMonotonicUp01(termCoverage),
      weight: weightOverrides["termCoverage"] ?? 1.0,
      skipped: false,
    },
    {
      name: "TermSparsity",
      rawValue: termSparsity,
      normalizedValue: normalizeMonotonicDown(termSparsity),
      weight: weightOverrides["termSparsity"] ?? 0.5,
      skipped: corpusTermFreqs == null,
      skipReason:
        corpusTermFreqs == null
          ? "Corpus term frequencies not provided"
          : undefined,
    },
  ];
}
