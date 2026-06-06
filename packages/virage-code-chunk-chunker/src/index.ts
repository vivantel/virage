import {
  chunk as codeChunk,
  detectLanguage,
  UnsupportedLanguageError,
} from "code-chunk";
import type { Chunk as CodeChunk, ChunkOptions } from "code-chunk";
import type {
  ChunkStrategy,
  Chunk,
  ChunkQualityMetrics,
} from "@vivantel/virage-core";
import { computeChunkQualityMetrics } from "@vivantel/virage-core";

export interface CodeChunkStrategyOptions {
  /** Maximum size of each chunk in bytes (default: 1500) */
  maxChunkSize?: number;
  /** How much context to include (default: "full") */
  contextMode?: "none" | "minimal" | "full";
  /** Level of sibling detail in context (default: "signatures") */
  siblingDetail?: "none" | "names" | "signatures";
  /** Remove import statements from chunks (default: false) */
  filterImports?: boolean;
  /** Number of lines to overlap from the previous chunk (default: 0) */
  overlapLines?: number;
  /**
   * Use `contextualizedText` (scope chain + entity signatures prepended)
   * instead of raw `text` as chunk content. Produces richer embeddings. (default: false)
   */
  useContextualizedText?: boolean;
}

export function codeChunkStrategy(
  options: CodeChunkStrategyOptions = {},
): ChunkStrategy {
  const { useContextualizedText = false, ...chunkOptions } =
    options as CodeChunkStrategyOptions & ChunkOptions;

  return {
    name: "codeChunkAst",

    async chunk(text: string, filePath?: string): Promise<Chunk[]> {
      if (!filePath) {
        return [];
      }

      let results: CodeChunk[];
      try {
        results = await codeChunk(filePath, text, chunkOptions);
      } catch (err: unknown) {
        if (err instanceof UnsupportedLanguageError) {
          return [];
        }
        throw err;
      }

      return results.map((c, i) => ({
        content: useContextualizedText ? c.contextualizedText : c.text,
        metadata: {
          strategy: "codeChunkAst",
          chunk_index: i,
          source_file: filePath,
          total_chunks: c.totalChunks,
          scope: c.context.scope,
          entities: c.context.entities,
        },
        sourceFile: filePath,
        commitHash: "",
      }));
    },

    extractMetadata(_text: string, filePath?: string): Record<string, unknown> {
      const language = filePath ? detectLanguage(filePath) : null;
      return {
        strategy: "codeChunkAst",
        language: language ?? "unknown",
        supported: language !== null,
      };
    },

    getQualityMetrics(chunks: Chunk[]): ChunkQualityMetrics {
      return computeChunkQualityMetrics(chunks);
    },
  };
}

export const ragPlugin = {
  name: "codeChunkAst",
  type: "chunker" as const,
  factory: () => codeChunkStrategy(),
};
