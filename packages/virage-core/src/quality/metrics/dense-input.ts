/**
 * Component 3 — Dense Input Preparation metrics (2 metrics)
 *
 * Text Purity:        fraction of printable/non-control characters in denseText.
 * Enrichment Quality: cosine similarity between raw chunk text and enriched denseText.
 */

import type { MetricResult } from "../interfaces.js";
import { normalizeMonotonicUp01 } from "../scoring.js";

export interface DenseInputMetricsInput {
  chunks: Array<{
    denseText: string;
    sparseText?: string;
  }>;
  embedFn: (text: string) => Promise<number[]>;
}

function isPrintable(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0x20 && cp !== 0x7f;
}

function computeTextPurity(denseText: string): number {
  if (denseText.length === 0) return 0;
  let printable = 0;
  for (const ch of denseText) {
    if (isPrintable(ch)) printable++;
  }
  return printable / denseText.length;
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

export async function computeDenseInputMetrics(
  input: DenseInputMetricsInput,
  sampleSize = 50,
  weightOverrides: Partial<Record<string, number>> = {},
): Promise<MetricResult[]> {
  const { chunks, embedFn } = input;
  const sample = chunks.slice(0, sampleSize);

  // Text Purity: mean across sample
  const purities = sample.map((c) => computeTextPurity(c.denseText));
  const purity =
    purities.length === 0
      ? 0
      : purities.reduce((s, v) => s + v, 0) / purities.length;

  // Enrichment Quality: only meaningful when sparseText (raw) != denseText (enriched)
  const enrichedPairs = sample.filter(
    (c) => c.sparseText != null && c.sparseText !== c.denseText,
  );

  let enrichmentQuality: number | null = null;
  if (enrichedPairs.length > 0) {
    const sims: number[] = [];
    for (const chunk of enrichedPairs) {
      const [rawEmbed, enrichedEmbed] = await Promise.all([
        embedFn(chunk.sparseText!),
        embedFn(chunk.denseText),
      ]);
      sims.push(cosineSim(rawEmbed, enrichedEmbed));
    }
    enrichmentQuality = sims.reduce((s, v) => s + v, 0) / sims.length;
  }

  return [
    {
      name: "TextPurity",
      rawValue: purity,
      normalizedValue: normalizeMonotonicUp01(purity),
      weight: weightOverrides["textPurity"] ?? 1.0,
      skipped: false,
    },
    {
      name: "EnrichmentQuality",
      rawValue: enrichmentQuality ?? 0,
      normalizedValue:
        enrichmentQuality != null
          ? normalizeMonotonicUp01((enrichmentQuality + 1) / 2)
          : 0,
      weight: weightOverrides["enrichmentQuality"] ?? 1.0,
      skipped: enrichmentQuality == null,
      skipReason:
        enrichmentQuality == null
          ? "sparseText equals denseText in all sampled chunks (no enrichment detected)"
          : undefined,
    },
  ];
}
