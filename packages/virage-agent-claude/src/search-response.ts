import { CHUNK_CHAR_LIMIT } from "./inject-context.js";

/**
 * Response-shaping for the MCP `search` tool (IR-048, virage-ee).
 *
 * The CLI's `--format json` output nests most fields under `metadata`:
 *   { rank, similarity, sourceFile, denseText, metadata: { chunkIndex, ... } }
 * This module flattens that (every field a top-level key) and trims the
 * default response to the 4 fields an agent actually uses, with an optional
 * `fields` override for the rest. This is a response-layer transform only —
 * the CLI's own `--format json` output (used by `eval`/`bench`/scripts) is
 * unchanged.
 */

export const DEFAULT_SEARCH_FIELDS = [
  "denseText",
  "sourceFile",
  "similarity",
  "citation",
] as const;

export const FULL_SEARCH_FIELDS = [
  ...DEFAULT_SEARCH_FIELDS,
  "chunkIndex",
  "totalChunks",
  "siblingIds",
  "siblingPrev",
  "siblingNext",
  "sourceFormat",
  "strategy",
  "estimatedTokens",
  "breadcrumb",
  "byteStart",
  "byteEnd",
] as const;

export type SearchField = (typeof FULL_SEARCH_FIELDS)[number];

export interface RawSearchResult {
  rank: number;
  similarity: number;
  sourceFile: string;
  denseText: string;
  metadata: Record<string, unknown>;
}

/**
 * Flatten + trim one raw CLI search result into the MCP response shape.
 *
 * `fields` unset (or empty) → the trimmed default: denseText (capped at
 * CHUNK_CHAR_LIMIT with a truncation marker), sourceFile, similarity,
 * citation. `fields` provided → exactly those fields, flat, and denseText
 * returned untruncated (the caller asked for it specifically).
 *
 * Citation: prefers a chunker-owned `metadata.citation` (e.g. xlsx cell
 * refs — not implemented as of this function, added when a chunker sets
 * one); falls back to `"line {lineStart}"` when `metadata.lineStart` is
 * present (populated for markdown/tree-sitter chunkers as of IR-048's
 * first increment — absent for chunkers that don't populate it yet, in
 * which case citation stays unset).
 */
export function transformSearchResults(
  raw: RawSearchResult[],
  fields?: readonly SearchField[],
): Record<string, unknown>[] {
  const usingDefault = fields == null || fields.length === 0;
  const selected = usingDefault ? DEFAULT_SEARCH_FIELDS : fields;

  return raw.map((r) => {
    const flat: Record<string, unknown> = {
      sourceFile: r.sourceFile,
      similarity: r.similarity,
      denseText: r.denseText,
      ...r.metadata,
    };

    if (flat.citation == null && typeof flat.lineStart === "number") {
      flat.citation = `line ${flat.lineStart}`;
    }

    const out: Record<string, unknown> = {};
    for (const field of selected) {
      if (field === "denseText") {
        const text = typeof flat.denseText === "string" ? flat.denseText : "";
        out.denseText =
          usingDefault && text.length > CHUNK_CHAR_LIMIT
            ? `${text.slice(0, CHUNK_CHAR_LIMIT)} (truncated, ${text.length} chars total — request "denseText" via fields to get the full chunk)`
            : text;
        continue;
      }
      if (field in flat) out[field] = flat[field];
    }
    return out;
  });
}
