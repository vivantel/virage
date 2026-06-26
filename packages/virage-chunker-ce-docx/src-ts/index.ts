import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { BaseOptions, ParseResult } from "@vivantel/virage-chunker-ce-ast";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type DocxChunkerOptions = BaseOptions;

export const createChunker = createNativeChunker<DocxChunkerOptions>({
  name: "@vivantel/virage-chunker-ce-docx",
  version: "0.1.2",
  sourceFormat: "docx",
  patterns: ["**/*.docx"],
  loadBinding: () => require("./virage_chunker_ce_docx.node"),
  callNative: (b, filePath) => b["parseDocx"](filePath) as unknown as ParseResult,
  extraWalkOpts: () => ({ overlap: 0.1 }),
});
