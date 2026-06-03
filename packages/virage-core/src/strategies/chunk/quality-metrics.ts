/**
 * Shared quality metric computation for ChunkStrategy implementations.
 */

import type { Chunk } from "../../interfaces/chunker.js";
import type { ChunkQualityMetrics } from "../../interfaces/quality.js";

/** Tokenise text by splitting on whitespace and punctuation. */
function tokenise(text: string): string[] {
  return text.split(/[\s\p{P}]+/u).filter(Boolean);
}

export function computeChunkQualityMetrics(
  chunks: Chunk[],
): ChunkQualityMetrics {
  if (chunks.length === 0) {
    return {
      avgChunkSize: 0,
      stdDevChunkSize: 0,
      semanticCoherence: 0,
      informationDensity: 0,
    };
  }

  const sizes = chunks.map((c) => c.content.length);
  const mean = sizes.reduce((s, v) => s + v, 0) / sizes.length;
  const variance =
    sizes.reduce((s, v) => s + (v - mean) ** 2, 0) / sizes.length;

  const sentenceTerminator = /[.!?\n]\s*$/;
  const coherentCount = chunks.filter((c) =>
    sentenceTerminator.test(c.content),
  ).length;

  const densities = chunks.map((c) => {
    const tokens = tokenise(c.content);
    if (tokens.length === 0) return 0;
    const unique = new Set(tokens.map((t) => t.toLowerCase())).size;
    return unique / tokens.length;
  });
  const avgDensity = densities.reduce((s, v) => s + v, 0) / densities.length;

  return {
    avgChunkSize: mean,
    stdDevChunkSize: Math.sqrt(variance),
    semanticCoherence: coherentCount / chunks.length,
    informationDensity: avgDensity,
  };
}
