import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { BaseOptions, ParseResult } from "@vivantel/virage-chunker-ce-ast";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const SUPPORTED_EXTENSIONS = [
  ".py",
  ".pyi",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".cxx",
  ".cc",
  ".hh",
  ".hpp",
  ".cs",
  ".rb",
];

/** Options for the multi-language tree-sitter code chunker. */
export interface LangChunkerOptions extends BaseOptions {
  /**
   * Explicit language override (e.g. "python"). When set, all files are
   * parsed as this language regardless of extension. Useful for files with
   * non-standard extensions.
   */
  language?: string;
}

export const createChunker = createNativeChunker<LangChunkerOptions>({
  name: "@vivantel/virage-chunker-ce-lang",
  version: "0.1.0",
  sourceFormat: "code",
  patterns: SUPPORTED_EXTENSIONS.map((ext) => `**/*${ext}`),
  loadBinding: () => require("./virage_chunker_ce_lang.node"),
  callNative: (b, filePath) =>
    b["parseCode"](filePath) as unknown as ParseResult,
});
