import { readdir } from "fs/promises";
import { extname, join } from "path";
import { IGNORED_DIRS } from "@vivantel/virage-core";

export { IGNORED_DIRS };

export interface ExtGroup {
  exts: string[];
  /** npm package name — must be published before being added here. */
  package: string;
  /** Plugin-specific options forwarded verbatim to `options` in the generated config. */
  options?: Record<string, unknown>;
  /** Optional semver constraint used when installing (skips fetchLatestVersion). */
  version?: string;
  name: string;
}

// INVARIANT: every package here must be published on npm before being added.
// Verify with: npm view <package> version
export const EXT_GROUPS: ExtGroup[] = [
  {
    exts: [".md", ".mdx"],
    package: "@vivantel/virage-chunker-ce-md",
    name: "markdown",
  },
  {
    exts: [".ts", ".tsx", ".mts", ".cts"],
    package: "@vivantel/virage-chunker-ce-lang",
    options: { maxTokens: 512 },
    name: "typescript",
  },
  {
    exts: [".js", ".jsx", ".mjs", ".cjs"],
    package: "@vivantel/virage-chunker-ce-lang",
    options: { maxTokens: 512 },
    name: "javascript",
  },
  {
    exts: [".py", ".pyi"],
    package: "@vivantel/virage-chunker-ce-lang",
    options: { maxTokens: 512 },
    name: "python",
  },
  {
    exts: [".go"],
    package: "@vivantel/virage-chunker-ce-lang",
    options: { maxTokens: 512 },
    name: "go",
  },
  {
    exts: [".java"],
    package: "@vivantel/virage-chunker-ce-lang",
    options: { maxTokens: 512 },
    name: "java",
  },
  {
    exts: [".cs"],
    package: "@vivantel/virage-chunker-ce-lang",
    options: { maxTokens: 512 },
    name: "csharp",
  },
  {
    exts: [".rs"],
    package: "@vivantel/virage-chunker-ce-lang",
    options: { maxTokens: 512 },
    name: "rust",
  },
  {
    exts: [".c", ".h"],
    package: "@vivantel/virage-chunker-ce-lang",
    options: { maxTokens: 512 },
    name: "c",
  },
  {
    exts: [".cpp", ".cxx", ".cc", ".hh", ".hpp"],
    package: "@vivantel/virage-chunker-ce-lang",
    options: { maxTokens: 512 },
    name: "cpp",
  },
  {
    exts: [".rb"],
    package: "@vivantel/virage-chunker-ce-lang",
    options: { maxTokens: 512 },
    name: "ruby",
  },
  {
    exts: [".pdf"],
    package: "@vivantel/virage-chunker-ce-pdf",
    options: { maxTokens: 512, overlapSentences: 1 },
    name: "pdf",
  },
  {
    exts: [".docx"],
    package: "@vivantel/virage-chunker-ce-docx",
    options: { maxTokens: 512, overlapSentences: 1 },
    name: "docx",
  },
  {
    exts: [".tex"],
    package: "@vivantel/virage-chunker-ce-latex",
    options: { maxTokens: 512, overlapSentences: 1 },
    name: "latex",
  },
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
