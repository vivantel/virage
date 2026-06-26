import { createHash } from "node:crypto";
import type { DocNode, ArtifactSet, FilterMeta, ChunkMeta } from "./types.js";
import { walkDocNode } from "./ast-walker.js";
import { extractOutline } from "./outline.js";
import type { TextSegment } from "./ast-walker.js";

export interface WalkOptions {
  sourceFile: string;
  sourceFormat: string;
  commitHash: string;
  strategy: string;
  sparseTextGeneratorId: string;
  metadataGeneratorId: string;
  /** Maximum tokens per chunk window (default: 512). */
  maxTokens?: number;
  /** Minimum tokens before merging a trailing window into its predecessor (default: maxTokens / 4). */
  minTokens?: number;
  /**
   * Sliding-window overlap as a fraction 0–1 (default: 0).
   * An overlap of 0.2 means each new window reuses the last 20 % of the previous
   * window's content, producing overlapping ArtifactSets that share context.
   */
  overlap?: number;
  /**
   * When true, segments that exceed maxTokens are recursively split on character
   * boundaries before windowing, rather than hard-cut with content loss (default: false).
   */
  recursive?: boolean;
  /**
   * When true, the effective flush threshold for `code` and `table-cell` segments
   * is halved, producing smaller chunks for dense technical content (default: false).
   */
  adaptiveSize?: boolean;
  fileHash?: string;
  fileSizeBytes?: number;
  fileModifiedAt?: string;
}

const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function makeDenseText(breadcrumb: string[], rawContent: string): string {
  const prefix = breadcrumb.length > 0 ? breadcrumb.join(" › ") + ". " : "";
  return prefix + rawContent;
}

function computeDenseTextHash(denseText: string): string {
  return createHash("sha256").update(denseText).digest("hex").slice(0, 16);
}

function sameBreadcrumb(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Pre-split text segments that individually exceed maxTokens into maxTokens-sized
 * pieces. Used when recursive=true to avoid content loss on hard-cut.
 */
function splitOversized(seg: TextSegment, maxTokens: number): TextSegment[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (seg.text.length <= maxChars) return [seg];
  const parts: TextSegment[] = [];
  let pos = 0;
  while (pos < seg.text.length) {
    const text = seg.text.slice(pos, pos + maxChars);
    parts.push({
      ...seg,
      text,
      attrs: {
        ...seg.attrs,
        byteStart: seg.attrs.byteStart + pos,
        byteEnd: seg.attrs.byteStart + pos + text.length,
      },
    });
    pos += maxChars;
  }
  return parts;
}

type Window = {
  texts: string[];
  byteStart: number;
  byteEnd: number;
  lineStart?: number;
  lineEnd?: number;
  pageStart?: number;
  pageEnd?: number;
  breadcrumb: string[];
  lang?: string;
  codeLanguage?: string;
  truncated: boolean;
};

/**
 * Walk a ViDoc AST and produce one ArtifactSet per logical window.
 *
 * Each window is split at paragraph/segment boundaries when the accumulated
 * token count reaches maxTokens. A section boundary (breadcrumb change) also
 * flushes the current window. Level 2 modifiers (overlap, recursive,
 * adaptiveSize) refine this behaviour.
 *
 * contextText is NOT stored — it is assembled on-the-fly at query time
 * using denseText, metadata.parentId, and metadata.siblingIds.
 */
export function walkToChunks(root: DocNode, opts: WalkOptions): ArtifactSet[] {
  const maxTokens = opts.maxTokens ?? 512;
  const minTokens = opts.minTokens ?? Math.floor(maxTokens / 4);
  const overlap = Math.min(Math.max(opts.overlap ?? 0, 0), 0.9);
  const recursive = opts.recursive ?? false;
  const adaptiveSize = opts.adaptiveSize ?? false;

  const documentOutline = extractOutline(root);
  const rawSegments = walkDocNode(root);

  if (rawSegments.length === 0) return [];

  // Pre-split oversized segments in recursive mode to avoid content loss.
  const segments: TextSegment[] = recursive
    ? rawSegments.flatMap((s) => splitOversized(s, maxTokens))
    : rawSegments;

  // ── Build windows ──────────────────────────────────────────────────────────

  const windows: Window[] = [];
  let startIdx = 0;

  while (startIdx < segments.length) {
    const firstSeg = segments[startIdx]!;
    const win: Window = {
      texts: [],
      byteStart: firstSeg.attrs.byteStart,
      byteEnd: firstSeg.attrs.byteEnd,
      breadcrumb: firstSeg.breadcrumb,
      truncated: false,
    };
    let currentTokens = 0;
    let idx = startIdx;

    while (idx < segments.length) {
      const seg = segments[idx]!;
      const isCompact =
        adaptiveSize &&
        (seg.nodeType === "code" || seg.nodeType === "table-cell");
      const effectiveMax = isCompact ? Math.ceil(maxTokens / 2) : maxTokens;
      const segTokens = estimateTokens(seg.text);

      // Flush if entering a new section (different breadcrumb).
      if (currentTokens > 0 && !sameBreadcrumb(seg.breadcrumb, win.breadcrumb)) {
        break;
      }

      // Flush if adding this segment would overflow an already-populated window.
      if (currentTokens > 0 && currentTokens + segTokens > effectiveMax) {
        break;
      }

      // Hard-cut a single oversized segment (only reached when recursive=false).
      if (segTokens > maxTokens) {
        const maxChars = maxTokens * CHARS_PER_TOKEN;
        win.texts.push(seg.text.slice(0, maxChars));
        win.byteEnd = seg.attrs.byteEnd;
        win.truncated = true;
        idx++;
        break;
      }

      win.texts.push(seg.text);
      win.byteEnd = seg.attrs.byteEnd;
      if (win.lineStart == null && seg.attrs.lineStart != null)
        win.lineStart = seg.attrs.lineStart;
      if (seg.attrs.lineEnd != null) win.lineEnd = seg.attrs.lineEnd;
      if (win.pageStart == null && seg.attrs.pageNumber != null)
        win.pageStart = seg.attrs.pageNumber;
      if (seg.attrs.pageNumber != null) win.pageEnd = seg.attrs.pageNumber;
      if (!win.lang && seg.attrs.lang) win.lang = seg.attrs.lang;
      if (!win.codeLanguage && seg.attrs.codeLanguage)
        win.codeLanguage = seg.attrs.codeLanguage;
      currentTokens += segTokens;
      idx++;
    }

    if (win.texts.length > 0) {
      windows.push(win);

      // Compute the next start index, accounting for overlap.
      if (overlap > 0 && idx > startIdx + 1) {
        // Walk backwards from idx until we've accumulated overlap * currentTokens.
        const targetOverlap = currentTokens * overlap;
        let accumulated = 0;
        let back = idx - 1;
        while (back > startIdx && accumulated < targetOverlap) {
          accumulated += estimateTokens(segments[back]!.text);
          back--;
        }
        startIdx = Math.max(startIdx + 1, back + 1);
      } else {
        startIdx = idx;
      }
    } else {
      // Safety: always advance to avoid infinite loop.
      startIdx++;
    }
  }

  // ── Merge trailing short window into predecessor (same section only) ───────
  if (windows.length > 1) {
    const last = windows[windows.length - 1]!;
    const prev = windows[windows.length - 2]!;
    const lastTokens = estimateTokens(last.texts.join("\n\n"));
    if (lastTokens < minTokens && sameBreadcrumb(last.breadcrumb, prev.breadcrumb)) {
      prev.texts.push(...last.texts);
      prev.byteEnd = last.byteEnd;
      prev.lineEnd = last.lineEnd;
      prev.pageEnd = last.pageEnd;
      windows.pop();
    }
  }

  const totalChunks = windows.length;

  // ── Build ArtifactSet[] ───────────────────────────────────────────────────
  const artifacts: ArtifactSet[] = windows.map((win, i) => {
    const rawContent = win.texts.join("\n\n");

    const filterMeta: FilterMeta = {
      sourceFile: opts.sourceFile,
      sourceFormat: opts.sourceFormat,
      breadcrumb: win.breadcrumb,
      byteStart: win.byteStart,
      byteEnd: win.byteEnd,
      lineStart: win.lineStart,
      lineEnd: win.lineEnd,
      pageStart: win.pageStart,
      pageEnd: win.pageEnd,
      lang: win.lang,
      codeLanguage: win.codeLanguage,
      chunkIndex: i,
      totalChunks,
      strategy: opts.strategy,
      estimatedTokens: estimateTokens(rawContent),
      ...(opts.fileHash != null ? { fileHash: opts.fileHash } : {}),
      ...(opts.fileModifiedAt != null
        ? { fileModifiedAt: opts.fileModifiedAt }
        : {}),
      ...(opts.fileSizeBytes != null
        ? { fileSizeBytes: opts.fileSizeBytes }
        : {}),
    };

    const fullMeta: ChunkMeta = {
      ...filterMeta,
      sectionTitle: win.breadcrumb.at(-1),
      headingLevel:
        win.breadcrumb.length > 0 ? win.breadcrumb.length : undefined,
      documentOutline,
      truncated: win.truncated || undefined,
    };

    const denseText = makeDenseText(win.breadcrumb, rawContent);

    return {
      denseText,
      sparseText: rawContent,
      denseTextHash: computeDenseTextHash(denseText),
      sparseTextGeneratorId: opts.sparseTextGeneratorId,
      metadataGeneratorId: opts.metadataGeneratorId,
      metadata: fullMeta,
      sourceFile: opts.sourceFile,
      commitHash: opts.commitHash,
    };
  });

  // ── Assign sibling IDs ────────────────────────────────────────────────────
  for (let i = 0; i < artifacts.length; i++) {
    const a = artifacts[i]!;
    const prev = i > 0 ? artifacts[i - 1] : undefined;
    const next = i < artifacts.length - 1 ? artifacts[i + 1] : undefined;

    if (prev) a.metadata.siblingPrev = prev.denseTextHash;
    if (next) a.metadata.siblingNext = next.denseTextHash;

    const siblingIds: string[] = [];
    if (prev) siblingIds.push(prev.denseTextHash);
    if (next) siblingIds.push(next.denseTextHash);
    if (siblingIds.length > 0) a.metadata.siblingIds = siblingIds;
  }

  return artifacts;
}
