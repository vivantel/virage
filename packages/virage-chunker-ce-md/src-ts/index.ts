import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { BaseOptions, ParseResult } from "@vivantel/virage-chunker-ce-ast";
import { createRequire } from "node:module";
import { platform, arch } from "node:process";

const require = createRequire(import.meta.url);

const PLATFORM_STUBS: Record<string, string> = {
  "linux-x64": "@vivantel/virage-chunker-ce-md-linux-x64-gnu",
  "linux-arm64": "@vivantel/virage-chunker-ce-md-linux-arm64-gnu",
  "darwin-x64": "@vivantel/virage-chunker-ce-md-darwin-x64",
  "darwin-arm64": "@vivantel/virage-chunker-ce-md-darwin-arm64",
  "win32-x64": "@vivantel/virage-chunker-ce-md-win32-x64-msvc",
};

function loadBinding(): Record<string, (...args: unknown[]) => string> {
  // Local dev build: napi places binary next to dist/
  try {
    return require("./virage_chunker_ce_md.node") as Record<string, (...args: unknown[]) => string>;
  } catch {
    /* fall through to platform stub */
  }
  // Installed platform stub (optionalDependency resolved by npm/pnpm/yarn)
  const key = `${platform}-${arch}`;
  const stubPkg = PLATFORM_STUBS[key];
  if (stubPkg) {
    try {
      return require(stubPkg) as Record<string, (...args: unknown[]) => string>;
    } catch {
      /* stub not installed */
    }
  }
  const hint = stubPkg ? `\n  npm install ${stubPkg}` : "";
  throw new Error(
    `[@vivantel/virage-chunker-ce-md] Native binary not found for ${key}.${hint}\nOr compile from source: npx napi build --release`,
  );
}

export type MdChunkerOptions = BaseOptions;

export const createChunker = createNativeChunker<MdChunkerOptions>({
  name: "@vivantel/virage-chunker-ce-md",
  version: "0.1.3",
  sourceFormat: "md",
  patterns: ["**/*.md", "**/*.mdx"],
  loadBinding,
  callNative: (b, filePath) => b["parseMd"](filePath) as unknown as ParseResult,
  extraWalkOpts: (opts) => ({ overlap: opts.overlap ?? 0.15 }),
});
