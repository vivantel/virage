import { createHash } from "crypto";

/** Build denseText: breadcrumb prefix (if any) concatenated with the full chunk body. */
export function makeDenseText(breadcrumb: string[], body: string): string {
  const prefix = breadcrumb.length > 0 ? breadcrumb.join(" › ") + ". " : "";
  return prefix + body;
}

/** Build sparseText: the raw chunk body, without breadcrumb, so BM25 scores are not biased by heading duplication. */
export function makeSparseText(body: string): string {
  return body;
}

/** Compute a 16-hex-char SHA-256 of denseText — the primary per-chunk cache key. */
export function computeDenseTextHash(denseText: string): string {
  return createHash("sha256").update(denseText).digest("hex").slice(0, 16);
}
