import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { BaseOptions, ParseResult } from "@vivantel/virage-chunker-ce-ast";
import { createRequire } from "node:module";
import { platform, arch } from "node:process";

const require = createRequire(import.meta.url);

const PLATFORM_STUBS: Record<string, string> = {
  "linux-x64": "@vivantel/virage-chunker-ce-latex-linux-x64-gnu",
  "linux-arm64": "@vivantel/virage-chunker-ce-latex-linux-arm64-gnu",
  "darwin-arm64": "@vivantel/virage-chunker-ce-latex-darwin-arm64",
  "win32-x64": "@vivantel/virage-chunker-ce-latex-win32-x64-msvc",
};

function loadBinding(): Record<string, (...args: unknown[]) => unknown> {
  try {
    return require("./virage_chunker_ce_latex.node") as Record<
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
    `[@vivantel/virage-chunker-ce-latex] Native binary not found for ${key}.${hint}\nOr compile from source: npx napi build --release`,
  );
}

export type LatexChunkerOptions = BaseOptions;

export const createChunker = createNativeChunker<LatexChunkerOptions>({
  name: "@vivantel/virage-chunker-ce-latex",
  version: "0.1.7",
  sourceFormat: "latex",
  patterns: ["**/*.tex", "**/*.latex"],
  loadBinding,
  callNative: (b, filePath) =>
    b["parseLatex"](filePath) as unknown as ParseResult,
  extraWalkOpts: () => ({ overlap: 0.1 }),
});
