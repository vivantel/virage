import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { minimatch } from "minimatch";
import type { TagRule as LabelRule } from "../interfaces/chunker.js";

// ─── Extension auto-labels ────────────────────────────────────────────────────

const EXTENSION_LABELS: Record<string, string> = {
  // Code
  ".ts": "language:typescript",
  ".tsx": "language:typescript",
  ".js": "language:javascript",
  ".jsx": "language:javascript",
  ".mjs": "language:javascript",
  ".cjs": "language:javascript",
  ".py": "language:python",
  ".java": "language:java",
  ".go": "language:go",
  ".rs": "language:rust",
  ".c": "language:c",
  ".cpp": "language:cpp",
  ".cc": "language:cpp",
  ".cxx": "language:cpp",
  ".cs": "language:csharp",
  ".rb": "language:ruby",
  ".kt": "language:kotlin",
  ".swift": "language:swift",
  ".php": "language:php",
  ".scala": "language:scala",
  ".sh": "language:shell",
  ".bash": "language:shell",
  ".zsh": "language:shell",
  ".fish": "language:shell",
  // Documents
  ".md": "format:markdown",
  ".mdx": "format:markdown",
  ".rst": "format:rst",
  ".tex": "format:latex",
  ".pdf": "format:pdf",
  ".docx": "format:docx",
  ".xlsx": "format:xlsx",
  ".pptx": "format:pptx",
  ".html": "format:html",
  ".htm": "format:html",
  ".epub": "format:epub",
  // Data / API
  ".json": "format:json",
  ".yaml": "format:yaml",
  ".yml": "format:yaml",
  ".toml": "format:toml",
  ".ipynb": "format:notebook",
};

/** Returns auto-labels derived from the file extension. Never throws. */
export function extensionLabels(filePath: string): string[] {
  const ext = extname(filePath).toLowerCase();
  const label = EXTENSION_LABELS[ext];
  return label ? [label] : [];
}

// ─── Path rule matching ───────────────────────────────────────────────────────

/**
 * Apply a list of LabelRule entries to a file path.
 * `filePath` should be relative to the source root and use forward slashes.
 * Returns the union of all matching rules' `add` arrays.
 */
export function applyLabelRules(
  filePath: string,
  rules: LabelRule[],
): string[] {
  const labels: string[] = [];
  for (const rule of rules) {
    if (minimatch(filePath, rule.match, { matchBase: false, dot: true })) {
      labels.push(...rule.add);
    }
  }
  return labels;
}

// ─── .virage-labels.json ─────────────────────────────────────────────────────

interface VirageLabelsFile {
  add?: string[];
  inherit?: boolean;
}

/**
 * Walk the directory tree from `filePath` up to `rootDir`, collecting labels
 * from each `.virage-labels.json` found along the way.
 *
 * Labels from parent directories are included first (lower precedence);
 * labels from directories closer to the file override (higher precedence via
 * order — duplicates are preserved so callers can dedupe if needed).
 *
 * A `.virage-labels.json` with `"inherit": false` stops traversal above it.
 */
export async function virageLabelsForFile(
  filePath: string,
  rootDir: string,
): Promise<string[]> {
  const abs = filePath.startsWith("/") ? filePath : join(rootDir, filePath);
  const fileDir = dirname(abs);
  const absRoot = rootDir;

  // Collect directories from file's dir up to root
  const dirs: string[] = [];
  let cur = fileDir;
  while (true) {
    dirs.push(cur);
    if (cur === absRoot || cur === dirname(cur)) break;
    cur = dirname(cur);
  }

  // Walk from root → file (parent labels first, child labels last = higher precedence)
  dirs.reverse();

  const accumulated: string[] = [];

  for (const dir of dirs) {
    const candidate = join(dir, ".virage-labels.json");
    if (!existsSync(candidate)) continue;

    let parsed: VirageLabelsFile;
    try {
      const raw = await readFile(candidate, "utf-8");
      parsed = JSON.parse(raw) as VirageLabelsFile;
    } catch {
      continue;
    }

    if (Array.isArray(parsed.add)) {
      accumulated.push(...parsed.add.filter((l) => typeof l === "string"));
    }

    // inherit: false means stop traversal (don't include ancestors)
    if (parsed.inherit === false) break;
  }

  return accumulated;
}

// ─── CODEOWNERS parser ────────────────────────────────────────────────────────

interface CodeownersEntry {
  pattern: string;
  owners: string[];
}

function parseCodeownersFile(content: string): CodeownersEntry[] {
  const entries: CodeownersEntry[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const pattern = parts[0];
    const owners = parts.slice(1);
    entries.push({ pattern, owners });
  }
  return entries;
}

/**
 * Convert a CODEOWNERS owner token (e.g. "@org/team-name", "@username") to a
 * label string (e.g. "team:team-name", "owner:username").
 */
function ownerToLabel(owner: string): string {
  const stripped = owner.startsWith("@") ? owner.slice(1) : owner;
  const slashIdx = stripped.indexOf("/");
  if (slashIdx >= 0) {
    // Org/team — use the team name part
    return `team:${stripped.slice(slashIdx + 1)}`;
  }
  return `owner:${stripped}`;
}

export class CodeownersResolver {
  private entries: CodeownersEntry[];

  constructor(entries: CodeownersEntry[]) {
    this.entries = entries;
  }

  static fromContent(content: string): CodeownersResolver {
    return new CodeownersResolver(parseCodeownersFile(content));
  }

  static async fromDir(dir: string): Promise<CodeownersResolver | null> {
    // CODEOWNERS can live in root, .github/, or docs/
    for (const candidate of [
      join(dir, ".github", "CODEOWNERS"),
      join(dir, "CODEOWNERS"),
      join(dir, "docs", "CODEOWNERS"),
    ]) {
      if (existsSync(candidate)) {
        try {
          const content = await readFile(candidate, "utf-8");
          return CodeownersResolver.fromContent(content);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  /**
   * Returns team/owner labels for a given file path (relative to repo root,
   * forward-slash separated). Last matching CODEOWNERS rule wins (per spec).
   */
  labelsForFile(filePath: string): string[] {
    let lastMatch: CodeownersEntry | undefined;
    const normalized = filePath.startsWith("/") ? filePath.slice(1) : filePath;

    for (const entry of this.entries) {
      let pattern = entry.pattern;
      // Patterns without a slash match any directory depth (like .gitignore)
      const matchBase = !pattern.includes("/");
      // Strip leading slash for matching
      if (pattern.startsWith("/")) pattern = pattern.slice(1);

      if (
        minimatch(normalized, pattern, {
          matchBase,
          dot: true,
          nocase: false,
        }) ||
        minimatch(normalized, `${pattern}/**`, {
          matchBase: false,
          dot: true,
        })
      ) {
        lastMatch = entry;
      }
    }

    if (!lastMatch) return [];
    return lastMatch.owners.map(ownerToLabel);
  }
}

// ─── Full label resolver ──────────────────────────────────────────────────────

export interface LabelPipelineOptions {
  rootDir: string;
  globalRules?: LabelRule[];
  chunkerRules?: LabelRule[];
  codeowners?: CodeownersResolver;
  /** Pre-computed labels from the source provider (S3 object tags, etc.). */
  providerLabels?: string[];
  /** Namespace label to add to every chunk (e.g. "ns:my-project"). */
  namespace?: string;
}

/**
 * Compute the full merged label set for a file.
 * Order (lowest to highest precedence, all merged):
 *   1. Namespace label (e.g. "ns:my-project")
 *   2. File-extension auto-label (e.g. "language:typescript")
 *   3. Provider labels (S3 tags, CODEOWNERS, .virage-labels.json from source provider)
 *   4. CODEOWNERS from repo
 *   5. .virage-labels.json from repo directory tree
 *   6. Global label rules (from chunking.filter.labels in config)
 *   7. Per-chunker label rules (from chunking.chunkers[n].labels in config)
 *
 * Duplicates are removed while preserving first-occurrence order.
 */
export async function resolveLabels(
  filePath: string,
  opts: LabelPipelineOptions,
): Promise<string[]> {
  const all: string[] = [];

  if (opts.namespace) all.push(opts.namespace);
  all.push(...extensionLabels(filePath));
  if (opts.providerLabels) all.push(...opts.providerLabels);
  if (opts.codeowners) all.push(...opts.codeowners.labelsForFile(filePath));

  const virageLabels = await virageLabelsForFile(filePath, opts.rootDir).catch(
    () => [],
  );
  all.push(...virageLabels);

  if (opts.globalRules)
    all.push(...applyLabelRules(filePath, opts.globalRules));
  if (opts.chunkerRules)
    all.push(...applyLabelRules(filePath, opts.chunkerRules));

  // Deduplicate preserving first-occurrence order
  const seen = new Set<string>();
  return all.filter((l) => {
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
}
