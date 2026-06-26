import { readFile } from "fs/promises";
import {
  chunk as codeChunk,
  detectLanguage,
  UnsupportedLanguageError,
} from "code-chunk";
import type { Chunk as CodeChunk, ChunkOptions } from "code-chunk";
import type { FileChunker, Chunk } from "@vivantel/virage-core";
import { computeDenseTextHash, makeDenseText } from "@vivantel/virage-core";
import { createHash } from "crypto";

const VERSION = "0.1.42";

const SUPPORTED_EXTENSIONS = [
  "**/*.{js,mjs,cjs,ts,tsx,jsx}",
  "**/*.{py,rb,go,rs,java,kt,scala}",
  "**/*.{c,cpp,cc,cxx,h,hpp}",
  "**/*.{cs,swift,m,mm}",
  "**/*.{php,lua,sh,bash,zsh}",
];

export interface CodeChunkOptions {
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
   * When true, `denseText` uses the scope-contextualized form (prepends
   * scope chain + sibling signatures) instead of raw body. Produces richer
   * embeddings at the cost of slightly longer texts. (default: false)
   */
  useContextualizedText?: boolean;
}

function optionsFingerprint(opts: CodeChunkOptions): string {
  const { useContextualizedText: _unused, ...sparseOpts } = opts;
  void _unused;
  return createHash("sha256")
    .update(JSON.stringify(sparseOpts))
    .digest("hex")
    .slice(0, 16);
}

export function createChunker(options: CodeChunkOptions = {}): FileChunker {
  const { useContextualizedText = false, ...chunkOptions } =
    options as CodeChunkOptions & ChunkOptions;

  const sparseId = `code-chunk-ast@${VERSION}:${optionsFingerprint(options)}`;
  const ctxHash = `code-chunk-ast@${VERSION}:ctx:${optionsFingerprint(options)}`;

  return {
    name: "code-chunk-ast",
    version: VERSION,
    patterns: SUPPORTED_EXTENSIONS,
    sparseTextGeneratorId: sparseId,
    metadataGeneratorId: ctxHash,

    async canProcess(filePath: string): Promise<boolean> {
      return detectLanguage(filePath) !== null;
    },

    async chunk(filePath: string, commitHash: string): Promise<Chunk[]> {
      const text = await readFile(filePath, "utf-8");

      let results: CodeChunk[];
      try {
        results = await codeChunk(filePath, text, chunkOptions);
      } catch (err: unknown) {
        if (err instanceof UnsupportedLanguageError) {
          return [];
        }
        throw err;
      }

      return results.map((c, i) => {
        const sparseText = c.text;
        const breadcrumb = c.context.scope.map((s) => s.name);
        const denseText = useContextualizedText
          ? c.contextualizedText
          : makeDenseText(breadcrumb, sparseText);

        return {
          denseText,
          sparseText,
          denseTextHash: computeDenseTextHash(denseText),
          sparseTextGeneratorId: sparseId,
          metadataGeneratorId: ctxHash,
          metadata: {
            strategy: "code-chunk-ast",
            chunkIndex: i,
            totalChunks: c.totalChunks,
          } as import("@vivantel/virage-core").ChunkMeta,
          sourceFile: filePath,
          commitHash,
        };
      });
    },
  };
}
