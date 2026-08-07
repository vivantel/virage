console.warn(
  "\x1b[33m⚠️  [deprecated]\x1b[0m @vivantel/virage-chunker-ce-pdf is deprecated." +
    " Use @vivantel/virage@2 instead: npm install -g @vivantel/virage@2",
);

import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { BaseOptions, ParseResult } from "@vivantel/virage-chunker-ce-ast";
import { createRequire } from "node:module";
import { platform, arch } from "node:process";

const require = createRequire(import.meta.url);

const PLATFORM_STUBS: Record<string, string> = {
  "linux-x64": "@vivantel/virage-chunker-ce-pdf-linux-x64-gnu",
  "linux-arm64": "@vivantel/virage-chunker-ce-pdf-linux-arm64-gnu",
  "darwin-arm64": "@vivantel/virage-chunker-ce-pdf-darwin-arm64",
  "win32-x64": "@vivantel/virage-chunker-ce-pdf-win32-x64-msvc",
};

function loadBinding(): Record<string, (...args: unknown[]) => unknown> {
  try {
    return require("./virage_chunker_ce_pdf.node") as Record<
      string,
      (...args: unknown[]) => unknown
    >;
  } catch {
    /* fall through to platform stub */
  }
  const key = `${platform}-${arch}`;
  const stubPkg = PLATFORM_STUBS[key];
  if (stubPkg) {
    try {
      return require(stubPkg) as Record<
        string,
        (...args: unknown[]) => unknown
      >;
    } catch {
      /* stub not installed */
    }
  }
  const hint = stubPkg ? `\n  npm install ${stubPkg}` : "";
  throw new Error(
    `[@vivantel/virage-chunker-ce-pdf] Native binary not found for ${key}.${hint}\nOr compile from source: npx napi build --release`,
  );
}

export type PdfChunkerOptions = BaseOptions;

export const createChunker = createNativeChunker<PdfChunkerOptions>({
  name: "@vivantel/virage-chunker-ce-pdf",
  version: "0.1.10",
  sourceFormat: "pdf",
  patterns: ["**/*.pdf"],
  loadBinding,
  callNative: (b, filePath) =>
    b["parsePdf"](filePath) as unknown as ParseResult,
});
