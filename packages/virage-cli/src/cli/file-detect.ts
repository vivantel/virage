import { readdir } from "fs/promises";
import { extname, join } from "path";
import { IGNORED_DIRS } from "@vivantel/virage-core";

export { IGNORED_DIRS };

export interface ExtGroup {
  exts: string[];
  strategyFn: string;
  name: string;
}

export const EXT_GROUPS: ExtGroup[] = [
  {
    exts: [".md", ".mdx"],
    strategyFn: "markdownHeadersStrategy",
    name: "markdown",
  },
  { exts: [".ts", ".tsx"], strategyFn: "tokenStrategy", name: "typescript" },
  { exts: [".js", ".jsx"], strategyFn: "tokenStrategy", name: "javascript" },
  { exts: [".py"], strategyFn: "tokenStrategy", name: "python" },
  { exts: [".go"], strategyFn: "tokenStrategy", name: "go" },
  { exts: [".cs"], strategyFn: "tokenStrategy", name: "csharp" },
  { exts: [".java"], strategyFn: "tokenStrategy", name: "java" },
  { exts: [".yaml", ".yml"], strategyFn: "wholeFileStrategy", name: "yaml" },
  { exts: [".txt"], strategyFn: "semanticStrategy", name: "text" },
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
