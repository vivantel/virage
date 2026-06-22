import { VirageDb, defaultVirageDb } from "@vivantel/virage-core";
import type { PipelineRunData } from "@vivantel/virage-core";
import { createOut } from "../output.js";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export async function runReport(
  dbPath: string = defaultVirageDb(),
  verbosity = 0,
): Promise<void> {
  const out = createOut(verbosity);
  let db: VirageDb;
  let records: PipelineRunData[];
  try {
    db = new VirageDb(dbPath);
    records = db.listPipelineRuns();
    db.close();
  } catch {
    out.error(
      `Could not read virage.db at "${dbPath}". Run the pipeline first to generate telemetry.`,
    );
    process.exit(1);
  }

  if (records.length === 0) {
    out.dim("No pipeline runs found in virage.db.");
    return;
  }

  records.sort((a, b) => a.runAt.localeCompare(b.runAt));
  const latest = records[records.length - 1];

  out.section(`📊 Observability Report (${records.length} runs)`);
  out.info(`  Latest run        : ${latest.runAt}`);
  out.info(`  Total duration    : ${fmt(latest.durationMs)}`);

  const s = latest.stages;
  if (s.gitTracking) {
    out.info(`\n  Git tracking      : ${fmt(s.gitTracking.durationMs)}`);
    out.info(`    Files scanned   : ${s.gitTracking.filesScanned}`);
    out.info(`    To process      : ${s.gitTracking.toProcess}`);
    out.info(`    To delete       : ${s.gitTracking.toDelete}`);
  }

  if (s.chunking) {
    out.info(`\n  Chunking          : ${fmt(s.chunking.durationMs)}`);
    out.info(`    Files processed : ${s.chunking.filesProcessed}`);
    out.info(`    Chunks generated: ${s.chunking.chunksGenerated}`);
    if (s.chunking.errors > 0) {
      out.warn(`    Errors          : ${s.chunking.errors}`);
    }
  }

  if (s.embedding) {
    const e = s.embedding;
    const total = e.chunksEmbedded + e.chunksSkipped;
    const hitRate = total > 0 ? e.chunksSkipped / total : 0;
    out.info(`\n  Embedding         : ${fmt(e.durationMs)}`);
    out.info(`    Chunks embedded : ${e.chunksEmbedded}`);
    out.info(
      `    Chunks skipped  : ${e.chunksSkipped} (cache hit rate: ${(hitRate * 100).toFixed(1)}%)`,
    );

    if (e.rateLimitEvents !== undefined && e.rateLimitEvents > 0) {
      out.warn(`    Rate limit events: ${e.rateLimitEvents}`);
    }

    if (e.latencySamples && e.latencySamples.length > 0) {
      const sorted = [...e.latencySamples].sort((a, b) => a - b);
      out.info(`    API latency p50 : ${fmt(percentile(sorted, 50))}`);
      out.info(`    API latency p95 : ${fmt(percentile(sorted, 95))}`);
      out.info(`    API latency p99 : ${fmt(percentile(sorted, 99))}`);
    }
  }

  if (s.upload) {
    out.info(`\n  Upload            : ${fmt(s.upload.durationMs)}`);
    out.info(`    Uploaded        : ${s.upload.uploaded}`);
    out.info(`    Deleted         : ${s.upload.deleted}`);
  }

  if (records.length > 1) {
    const durations = records.map((r) => r.durationMs);
    const avgDuration = durations.reduce((s, v) => s + v, 0) / durations.length;
    out.info(`\n  Average run time  : ${fmt(Math.round(avgDuration))}`);
    out.info(`  Fastest run       : ${fmt(Math.min(...durations))}`);
    out.info(`  Slowest run       : ${fmt(Math.max(...durations))}`);
  }

  out.divider();
}
