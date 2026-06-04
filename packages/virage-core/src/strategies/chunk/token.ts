import { ChunkStrategy, Chunk } from "../../interfaces/index.js";
import type { ChunkQualityMetrics } from "../../interfaces/quality.js";
import { computeChunkQualityMetrics } from "./quality-metrics.js";

export interface TokenStrategyOptions {
  maxTokens?: number;
  overlap?: number;
}

/**
 * Split text by approximate token count.
 * Simple implementation: ~4 chars per token for English.
 * For production, use a proper tokenizer (tiktoken, etc.)
 */
export function tokenStrategy(
  options: TokenStrategyOptions = {},
): ChunkStrategy {
  const maxTokens = options.maxTokens ?? 500;
  const overlap = options.overlap ?? 50;
  const charsPerToken = 4;
  const maxChars = maxTokens * charsPerToken;
  // Clamp overlap so it never equals or exceeds maxChars, guaranteeing forward progress.
  const safeOverlap = Math.min(overlap, maxTokens - 1);
  const overlapChars = safeOverlap * charsPerToken;
  const stepChars = maxChars - overlapChars; // minimum advance per iteration

  return {
    name: `token-${maxTokens}`,

    async chunk(text: string, filePath?: string): Promise<Chunk[]> {
      const chunks: Chunk[] = [];
      let start = 0;

      while (start < text.length) {
        let end = Math.min(start + maxChars, text.length);

        // Only snap to a sentence/line boundary when it falls in the second half
        // of the window. Searching from the full end position can land on a break
        // point just past `start` (e.g. first newline inside a template literal),
        // which produces tiny chunks and triggers the one-char crawl loop.
        if (end < text.length) {
          const minBreak = start + Math.floor(maxChars / 2);
          const lastPeriod = text.lastIndexOf(".", end);
          const lastNewline = text.lastIndexOf("\n", end);
          const breakPoint = Math.max(lastPeriod, lastNewline);
          if (breakPoint >= minBreak) {
            end = breakPoint + 1;
          }
        }

        const content = text.slice(start, end).trim();
        if (content) {
          chunks.push({
            content,
            metadata: {
              strategy: this.name,
              chunk_index: chunks.length,
              source_file: filePath,
              start_char: start,
              end_char: end,
            },
            sourceFile: filePath || "unknown",
            commitHash: "", // Will be filled by caller
          });
        }

        // Advance by overlap window, but never less than stepChars to prevent
        // the one-char crawl when the boundary lands too close to start.
        const nextStart = end - overlapChars;
        start = nextStart > start ? nextStart : start + stepChars;
      }

      return chunks;
    },

    extractMetadata(text: string, _filePath?: string): Record<string, unknown> {
      return {
        strategy: this.name,
        char_count: text.length,
        estimated_tokens: Math.ceil(text.length / charsPerToken),
      };
    },

    getQualityMetrics(chunks: Chunk[]): ChunkQualityMetrics {
      return computeChunkQualityMetrics(chunks);
    },
  };
}
