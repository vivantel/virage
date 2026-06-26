import { readdir } from "fs/promises";
import { extname, join } from "path";
import { IGNORED_DIRS } from "@vivantel/virage-core";

export { IGNORED_DIRS };

export interface ExtGroup {
  exts: string[];
  /** Package name (e.g. `@vivantel/virage-chunker-ce-md`) or built-in alias (`token`, `wholeFile`, `semantic`). Package-based entries are emitted as `{ package, include }` per ADR-038; built-in aliases use legacy `{ name, patterns, strategy }` until replacement packages exist. */
  strategy: string;
  /** Optional semver constraint used when installing a package-name strategy (skips fetchLatestVersion). */
  version?: string;
  /** Plugin-specific options forwarded verbatim to `strategyOptions` in the generated config. */
  strategyOptions?: Record<string, unknown>;
  name: string;
}

export const EXT_GROUPS: ExtGroup[] = [
  {
    exts: [".md", ".mdx"],
    strategy: "@vivantel/virage-chunker-ce-md",
    name: "markdown",
  },
  {
    exts: [".ts", ".tsx"],
    strategy: "@vivantel/virage-code-chunk-chunker",
    name: "typescript",
  },
  {
    exts: [".js", ".jsx"],
    strategy: "@vivantel/virage-code-chunk-chunker",
    name: "javascript",
  },
  {
    exts: [".py"],
    strategy: "@vivantel/virage-code-chunk-chunker",
    name: "python",
  },
  {
    exts: [".go"],
    strategy: "@vivantel/virage-code-chunk-chunker",
    name: "go",
  },
  { exts: [".cs"], strategy: "token", name: "csharp" },
  {
    exts: [".java"],
    strategy: "@vivantel/virage-code-chunk-chunker",
    name: "java",
  },
  { exts: [".yaml", ".yml"], strategy: "wholeFile", name: "yaml" },
  { exts: [".txt"], strategy: "semantic", name: "text" },
];

export async function collectExtensions(
  dir: string,
  found: Set<string>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        await collectExtensions(join(dir, entry.name), found);
      }
    } else {
      const ext = extname(entry.name).toLowerCase();
      if (ext) found.add(ext);
    }
  }
}

export async function detectFileExtensions(cwd: string): Promise<ExtGroup[]> {
  const found = new Set<string>();
  await collectExtensions(cwd, found);
  return EXT_GROUPS.filter((g) => g.exts.some((e) => found.has(e)));
}
