import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { BaseOptions, ParseResult } from "@vivantel/virage-chunker-ce-ast";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type LatexChunkerOptions = BaseOptions;

export const createChunker = createNativeChunker<LatexChunkerOptions>({
  name: "@vivantel/virage-chunker-ce-latex",
  version: "0.1.2",
  sourceFormat: "latex",
  patterns: ["**/*.tex", "**/*.latex"],
  loadBinding: () => require("./virage_chunker_ce_latex.node"),
  callNative: (b, filePath) => b["parseLatex"](filePath) as unknown as ParseResult,
  extraWalkOpts: () => ({ overlap: 0.1 }),
});
