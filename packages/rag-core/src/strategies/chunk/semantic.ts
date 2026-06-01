import { ChunkStrategy, Chunk } from "../../interfaces/index.js";
import type { ChunkQualityMetrics } from "../../interfaces/quality.js";
import { computeChunkQualityMetrics } from "./quality-metrics.js";

export interface SemanticStrategyOptions {
  maxChars?: number;
  minChars?: number;
}

export function semanticStrategy(
  options: SemanticStrategyOptions = {},
): ChunkStrategy {
  const maxChars = options.maxChars ?? 2000;
  const minChars = options.minChars ?? 100;

  return {
    name: "semantic",

    async chunk(text: string, filePath?: string): Promise<Chunk[]> {
      const chunks: Chunk[] = [];

      // Split by sentences (simple approach)
      const sentences = text.split(/(?<=[.!?])\s+/);

      let currentChunk: string[] = [];
      let currentSize = 0;

      for (const sentence of sentences) {
        const sentenceSize = sentence.length;

        if (currentSize + sentenceSize > maxChars && currentChunk.length > 0) {
          const content = currentChunk.join(" ").trim();
          if (content.length >= minChars) {
            chunks.push({
              content,
              metadata: {
                strategy: this.name,
                sentence_count: currentChunk.length,
                source_file: filePath,
              },
              sourceFile: filePath || "unknown",
              commitHash: "",
            });
          }
          currentChunk = [];
          currentSize = 0;
        }

        currentChunk.push(sentence);
        currentSize += sentenceSize;
      }

      // Last chunk
      if (currentChunk.length > 0) {
        const content = currentChunk.join(" ").trim();
        if (content.length >= minChars) {
          chunks.push({
            content,
            metadata: {
              strategy: this.name,
              sentence_count: currentChunk.length,
              source_file: filePath,
              is_last: true,
            },
            sourceFile: filePath || "unknown",
            commitHash: "",
          });
        }
      }

      return chunks;
    },

    extractMetadata(text: string, _filePath?: string): Record<string, unknown> {
      return {
        strategy: this.name,
        sentence_count: text.split(/[.!?]+/).length,
        char_count: text.length,
      };
    },

    getQualityMetrics(chunks: Chunk[]): ChunkQualityMetrics {
      return computeChunkQualityMetrics(chunks);
    },
  };
}
