/**
 * Quality history — persists QualityReport runs to disk and generates
 * benchmark-action/github-action-benchmark compatible JSON.
 *
 * Storage layout:
 *   <historyDir>/<ISO-timestamp>-quality.json  — full QualityReport
 *   <historyDir>/benchmark-data.json           — latest benchmark-action feed
 */

import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import type { QualityReport } from "./interfaces.js";

// ─── Benchmark-action format ──────────────────────────────────────────────────

export interface BenchmarkDataPoint {
  name: string;
  unit: "score";
  value: number;
  /** When true, lower is better (benchmark-action customSmallerIsBetter) */
  biggerIsBetter?: boolean;
}

function reportToBenchmarkData(report: QualityReport): BenchmarkDataPoint[] {
  const points: BenchmarkDataPoint[] = [];

  // Overall score
  points.push({
    name: "Overall Quality",
    unit: "score",
    value: Number(report.overallScore.toFixed(4)),
    biggerIsBetter: true,
  });

  // Per-component scores
  for (const comp of report.components) {
    if (comp.skipped) continue;
    points.push({
      name: comp.label,
      unit: "score",
      value: Number(comp.score.toFixed(4)),
      biggerIsBetter: true,
    });

    // Per-metric normalized values (all [0,1], bigger is always better here)
    for (const m of comp.metrics) {
      if (m.skipped) continue;
      points.push({
        name: m.name,
        unit: "score",
        value: Number(m.normalizedValue.toFixed(4)),
        biggerIsBetter: true,
      });
    }
  }

  // RAGBench metrics (if present)
  if (report.ragBench) {
    const rb = report.ragBench;
    const k = rb.topK;
    for (const [label, value] of [
      [`RAGBench MRR@${k}`, rb.mrrAtK],
      [`RAGBench NDCG@${k}`, rb.ndcgAtK],
      [`RAGBench Recall@${k}`, rb.recallAtK],
      [`RAGBench Precision@${k}`, rb.precisionAtK],
      [`RAGBench HitRate@${k}`, rb.hitRateAtK],
    ] as Array<[string, number]>) {
      points.push({
        name: label,
        unit: "score",
        value: Number(value.toFixed(4)),
        biggerIsBetter: true,
      });
    }
  }

  return points;
}

// ─── Shields.io badge ─────────────────────────────────────────────────────────

export interface ShieldsBadge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: "brightgreen" | "green" | "yellow" | "orange" | "red";
}

function makeQualityBadge(overallScore: number, status: string): ShieldsBadge {
  const percent = Math.round(overallScore * 100);
  let color: ShieldsBadge["color"];
  if (status === "FAIL") {
    color = "red";
  } else if (percent >= 80) {
    color = "brightgreen";
  } else if (percent >= 70) {
    color = "green";
  } else if (percent >= 55) {
    color = "yellow";
  } else {
    color = "orange";
  }
  return {
    schemaVersion: 1,
    label: "quality",
    message: `${percent}%`,
    color,
  };
}

// ─── History entry (lightweight index) ───────────────────────────────────────

export interface HistoryEntry {
  id: string;
  timestamp: string;
  overallScore: number;
  status: string;
  sampleSize: number;
  durationMs: number;
  file: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SaveHistoryOptions {
  historyDir?: string;
  maxRuns?: number;
}

const DEFAULT_HISTORY_DIR = ".virage/quality-history";

export async function saveQualityHistory(
  report: QualityReport,
  options: SaveHistoryOptions = {},
): Promise<{ historyFile: string; benchmarkFile: string }> {
  const historyDir = options.historyDir ?? DEFAULT_HISTORY_DIR;
  const maxRuns = options.maxRuns ?? 100;

  await mkdir(historyDir, { recursive: true });

  // Save full report
  const id = report.timestamp.replace(/[:.]/g, "-");
  const historyFile = join(historyDir, `${id}-quality.json`);
  await writeFile(historyFile, JSON.stringify(report, null, 2), "utf-8");

  // Write benchmark-action compatible data
  const benchmarkData = reportToBenchmarkData(report);
  const benchmarkFile = join(historyDir, "benchmark-data.json");
  await writeFile(
    benchmarkFile,
    JSON.stringify(benchmarkData, null, 2),
    "utf-8",
  );

  // Write shields.io badge data
  const badge = makeQualityBadge(report.overallScore, report.status);
  await writeFile(
    join(historyDir, "quality-badge.json"),
    JSON.stringify(badge, null, 2),
    "utf-8",
  );

  // Prune old runs (keep maxRuns most recent)
  await pruneHistory(historyDir, maxRuns);

  return { historyFile, benchmarkFile };
}

async function pruneHistory(dir: string, maxRuns: number): Promise<void> {
  const entries = await readdir(dir);
  const runFiles = entries
    .filter((f) => f.endsWith("-quality.json"))
    .sort()
    .reverse();

  if (runFiles.length > maxRuns) {
    const { unlink } = await import("fs/promises");
    for (const f of runFiles.slice(maxRuns)) {
      await unlink(join(dir, f)).catch(() => {});
    }
  }
}

export async function listQualityHistory(
  historyDir = DEFAULT_HISTORY_DIR,
): Promise<HistoryEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(historyDir);
  } catch {
    return [];
  }

  const runFiles = entries
    .filter((f) => f.endsWith("-quality.json"))
    .sort()
    .reverse();

  const results: HistoryEntry[] = [];
  for (const f of runFiles) {
    try {
      const raw = await readFile(join(historyDir, f), "utf-8");
      const report = JSON.parse(raw) as QualityReport;
      const id = f.replace(/-quality\.json$/, "");
      results.push({
        id,
        timestamp: report.timestamp,
        overallScore: report.overallScore,
        status: report.status,
        sampleSize: report.sampleSize,
        durationMs: report.durationMs,
        file: join(historyDir, f),
      });
    } catch {
      // skip corrupt entries
    }
  }
  return results;
}

export async function loadQualityHistoryEntry(
  id: string,
  historyDir = DEFAULT_HISTORY_DIR,
): Promise<QualityReport | null> {
  const file = join(historyDir, `${id}-quality.json`);
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as QualityReport;
  } catch {
    return null;
  }
}
