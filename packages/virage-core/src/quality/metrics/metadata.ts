/**
 * Component 2 — Metadata Extraction metrics (5 metrics)
 *
 * Completeness:          fraction of expected fields non-empty per chunk.
 * Breadcrumb Consistency: common breadcrumb prefix within each file.
 * FQN Completeness:      fraction of code chunks with non-empty FQN.
 * Import Resolution:     fraction of import statements resolved to real files. (must-pass >0.70)
 * Sibling Integrity:     fraction of sibling links (prev/next) pointing to existing chunks.
 */

import type { MetricResult } from "../interfaces.js";
import { normalizeMonotonicUp01 } from "../scoring.js";

const EXPECTED_FIELDS = ["breadcrumb", "fqn", "imports", "siblings"];

export interface MetadataChunk {
  id?: string;
  breadcrumb?: string;
  fqn?: string;
  imports?: string[];
  resolvedImports?: number;
  totalImports?: number;
  prevId?: string;
  nextId?: string;
  sourceFile?: string;
  isCode?: boolean;
}

export interface MetadataMetricsInput {
  chunks: Array<{ metadata?: MetadataChunk; denseText?: string }>;
  chunkIdSet?: Set<string>;
}

function computeCompleteness(chunks: MetadataMetricsInput["chunks"]): number {
  if (chunks.length === 0) return 0;
  let totalFields = 0;
  let nonEmpty = 0;
  for (const { metadata: m } of chunks) {
    if (!m) continue;
    for (const field of EXPECTED_FIELDS) {
      totalFields++;
      const v = (m as Record<string, unknown>)[field];
      if (v != null && v !== "" && !(Array.isArray(v) && v.length === 0)) {
        nonEmpty++;
      }
    }
  }
  return totalFields === 0 ? 0 : nonEmpty / totalFields;
}

function computeBreadcrumbConsistency(
  chunks: MetadataMetricsInput["chunks"],
): number {
  const byFile = new Map<string, string[]>();
  for (const { metadata: m } of chunks) {
    if (!m?.sourceFile || !m.breadcrumb) continue;
    const list = byFile.get(m.sourceFile) ?? [];
    list.push(m.breadcrumb);
    byFile.set(m.sourceFile, list);
  }
  if (byFile.size === 0) return 0;

  const fileScores: number[] = [];
  for (const crumbs of byFile.values()) {
    if (crumbs.length === 0) continue;
    const maxLen = Math.max(...crumbs.map((c) => c.length));
    if (maxLen === 0) {
      fileScores.push(1);
      continue;
    }
    const reference = crumbs[0];
    let commonLen = 0;
    for (let i = 0; i < reference.length; i++) {
      if (crumbs.every((c) => c[i] === reference[i])) commonLen = i + 1;
      else break;
    }
    fileScores.push(commonLen / maxLen);
  }

  return fileScores.length === 0
    ? 0
    : fileScores.reduce((s, v) => s + v, 0) / fileScores.length;
}

function computeFqnCompleteness(
  chunks: MetadataMetricsInput["chunks"],
): number | null {
  const codeChunks = chunks.filter((c) => c.metadata?.isCode);
  if (codeChunks.length === 0) return null;
  const withFqn = codeChunks.filter(
    (c) => c.metadata?.fqn && c.metadata.fqn.length > 0,
  );
  return withFqn.length / codeChunks.length;
}

function computeImportResolution(
  chunks: MetadataMetricsInput["chunks"],
): number | null {
  let total = 0;
  let resolved = 0;
  for (const { metadata: m } of chunks) {
    if (m?.totalImports != null) {
      total += m.totalImports;
      resolved += m.resolvedImports ?? 0;
    }
  }
  if (total === 0) return null;
  return resolved / total;
}

function computeSiblingIntegrity(
  chunks: MetadataMetricsInput["chunks"],
  chunkIdSet: Set<string>,
): number | null {
  let totalLinks = 0;
  let validLinks = 0;
  for (const { metadata: m } of chunks) {
    if (!m) continue;
    if (m.prevId !== undefined) {
      totalLinks++;
      if (chunkIdSet.has(m.prevId)) validLinks++;
    }
    if (m.nextId !== undefined) {
      totalLinks++;
      if (chunkIdSet.has(m.nextId)) validLinks++;
    }
  }
  if (totalLinks === 0) return null;
  return validLinks / totalLinks;
}

export function computeMetadataMetrics(
  input: MetadataMetricsInput,
  importThreshold = 0.7,
  weightOverrides: Partial<Record<string, number>> = {},
): MetricResult[] {
  const { chunks, chunkIdSet = new Set() } = input;

  const completeness = computeCompleteness(chunks);
  const breadcrumbConsistency = computeBreadcrumbConsistency(chunks);
  const fqnCompleteness = computeFqnCompleteness(chunks);
  const importResolution = computeImportResolution(chunks);
  const siblingIntegrity = computeSiblingIntegrity(chunks, chunkIdSet);

  return [
    {
      name: "Completeness",
      rawValue: completeness,
      normalizedValue: normalizeMonotonicUp01(completeness),
      weight: weightOverrides["completeness"] ?? 1.0,
      skipped: false,
    },
    {
      name: "BreadcrumbConsistency",
      rawValue: breadcrumbConsistency,
      normalizedValue: normalizeMonotonicUp01(breadcrumbConsistency),
      weight: weightOverrides["breadcrumbConsistency"] ?? 1.0,
      skipped: false,
    },
    {
      name: "FQNCompleteness",
      rawValue: fqnCompleteness ?? 0,
      normalizedValue:
        fqnCompleteness != null ? normalizeMonotonicUp01(fqnCompleteness) : 0,
      weight: weightOverrides["fqnCompleteness"] ?? 1.0,
      skipped: fqnCompleteness == null,
      skipReason:
        fqnCompleteness == null ? "No code chunks found in sample" : undefined,
    },
    {
      name: "ImportResolution",
      rawValue: importResolution ?? 0,
      normalizedValue:
        importResolution != null ? normalizeMonotonicUp01(importResolution) : 0,
      weight: weightOverrides["importResolution"] ?? 1.0,
      skipped: importResolution == null,
      skipReason:
        importResolution == null
          ? "No import statements found in metadata"
          : undefined,
      mustPass: true,
      mustPassThreshold: importThreshold,
      mustPassPassed:
        importResolution != null
          ? importResolution > importThreshold
          : undefined,
    },
    {
      name: "SiblingIntegrity",
      rawValue: siblingIntegrity ?? 0,
      normalizedValue:
        siblingIntegrity != null ? normalizeMonotonicUp01(siblingIntegrity) : 0,
      weight: weightOverrides["siblingIntegrity"] ?? 0.5,
      skipped: siblingIntegrity == null,
      skipReason:
        siblingIntegrity == null
          ? "No sibling links found in chunk metadata"
          : undefined,
    },
  ];
}
