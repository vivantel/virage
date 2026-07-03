import { minimatch } from "minimatch";
import type { TagRule } from "../interfaces/chunker.js";

/**
 * Apply a list of TagRule entries to a file path (ADR-043, ADR-046).
 * `filePath` should be relative to the source root and use forward slashes.
 * Returns the union of all matching rules' `add` arrays.
 */
export function applyTagRules(filePath: string, rules: TagRule[]): string[] {
  const tags: string[] = [];
  for (const rule of rules) {
    if (minimatch(filePath, rule.match, { matchBase: false, dot: true })) {
      tags.push(...rule.add);
    }
  }
  return tags;
}

/**
 * Compute the full tag set for a file within a fileSet.
 * Merges fileSet-level tags (all files) with tagRule matches (per-file).
 * Duplicates are removed while preserving first-occurrence order.
 */
export function resolveFileTags(
  filePath: string,
  fileSetTags: string[],
  tagRules: TagRule[],
): string[] {
  const all = [...fileSetTags, ...applyTagRules(filePath, tagRules)];
  const seen = new Set<string>();
  return all.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}
