/**
 * Component 6 — Lexical Retrieval metrics (1 metric) [optional]
 *
 * Lexical Recall@K: same as Self-Recall but using BM25/FTS instead of dense search.
 * Skipped when FTS is not available on the configured vector store.
 */

import type { MetricResult } from "../interfaces.js";
import { normalizeMonotonicUp01 } from "../scoring.js";

export interface LexicalRetrievalMetricsInput {
  chunks: Array<{ id: string; denseText: string; anchorText?: string }>;
  ftsSearchFn:
    | ((query: string, topK: number) => Promise<Array<{ id: string }>>)
    | null;
  topK: number;
}

export async function computeLexicalRetrievalMetrics(
  input: LexicalRetrievalMetricsInput,
  weightOverrides: Partial<Record<string, number>> = {},
): Promise<MetricResult[]> {
  const { chunks, ftsSearchFn, topK } = input;

  if (!ftsSearchFn) {
    return [
      {
        name: "LexicalRecall@K",
        rawValue: 0,
        normalizedValue: 0,
        weight: weightOverrides["lexicalRecall"] ?? 1.5,
        skipped: true,
        skipReason: "FTS/BM25 search not available on this vector store",
      },
    ];
  }

  if (chunks.length === 0) {
    return [
      {
        name: "LexicalRecall@K",
        rawValue: 0,
        normalizedValue: 0,
        weight: weightOverrides["lexicalRecall"] ?? 1.5,
        skipped: true,
        skipReason: "No chunks in sample",
      },
    ];
  }

  let hits = 0;
  for (const chunk of chunks) {
    const query = chunk.anchorText ?? chunk.denseText.slice(0, 80);
    const results = await ftsSearchFn(query, topK);
    if (results.some((r) => r.id === chunk.id)) hits++;
  }
  const lexicalRecall = hits / chunks.length;

  return [
    {
      name: "LexicalRecall@K",
      rawValue: lexicalRecall,
      normalizedValue: normalizeMonotonicUp01(lexicalRecall),
      weight: weightOverrides["lexicalRecall"] ?? 1.5,
      skipped: false,
    },
  ];
}
