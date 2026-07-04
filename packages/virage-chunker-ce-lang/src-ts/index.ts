import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { BaseOptions, ParseResult } from "@vivantel/virage-chunker-ce-ast";
import { createRequire } from "node:module";
import { platform, arch } from "node:process";

const require = createRequire(import.meta.url);

const PLATFORM_STUBS: Record<string, string> = {
  "linux-x64": "@vivantel/virage-chunker-ce-lang-linux-x64-gnu",
  "linux-arm64": "@vivantel/virage-chunker-ce-lang-linux-arm64-gnu",
  "darwin-arm64": "@vivantel/virage-chunker-ce-lang-darwin-arm64",
  "win32-x64": "@vivantel/virage-chunker-ce-lang-win32-x64-msvc",
};

function loadBinding(): Record<string, (...args: unknown[]) => unknown> {
  try {
    return require("./virage_chunker_ce_lang.node") as Record<
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
    `[@vivantel/virage-chunker-ce-lang] Native binary not found for ${key}.${hint}\nOr compile from source: npx napi build --release`,
  );
}

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
  version: "0.1.2",
  sourceFormat: "code",
  patterns: SUPPORTED_EXTENSIONS.map((ext) => `**/*${ext}`),
  loadBinding,
  callNative: (b, filePath) =>
    b["parseCode"](filePath) as unknown as ParseResult,
});
