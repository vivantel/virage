import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { BaseOptions, ParseResult } from "@vivantel/virage-chunker-ce-ast";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type PdfChunkerOptions = BaseOptions;

export const createChunker = createNativeChunker<PdfChunkerOptions>({
  name: "@vivantel/virage-chunker-ce-pdf",
  version: "0.1.5",
  sourceFormat: "pdf",
  patterns: ["**/*.pdf"],
  loadBinding: () => require("./virage_chunker_ce_pdf.node"),
  callNative: (b, filePath) => b["parsePdf"](filePath) as unknown as ParseResult,
});
