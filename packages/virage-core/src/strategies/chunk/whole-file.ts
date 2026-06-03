import { ChunkStrategy, Chunk } from "../../interfaces/index.js";
import type { ChunkQualityMetrics } from "../../interfaces/quality.js";
import { computeChunkQualityMetrics } from "./quality-metrics.js";

export function wholeFileStrategy(): ChunkStrategy {
  return {
    name: "whole-file",

    async chunk(text: string, filePath?: string): Promise<Chunk[]> {
      if (!text || text.trim().length === 0) {
        return [];
      }

      return [
        {
          content: text,
          metadata: {
            strategy: this.name,
            source_file: filePath,
            char_count: text.length,
            line_count: text.split("\n").length,
          },
          sourceFile: filePath || "unknown",
          commitHash: "",
        },
      ];
    },

    extractMetadata(text: string, _filePath?: string): Record<string, unknown> {
      return {
        strategy: this.name,
        char_count: text.length,
        line_count: text.split("\n").length,
      };
    },

    getQualityMetrics(chunks: Chunk[]): ChunkQualityMetrics {
      return computeChunkQualityMetrics(chunks);
    },
  };
}
