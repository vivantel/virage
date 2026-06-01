import { readdir, readFile } from "fs/promises";
import { join } from "path";

interface EmbeddingStage {
  chunksEmbedded: number;
  chunksSkipped: number;
  durationMs: number;
  latencySamples?: number[];
  rateLimitEvents?: number;
}

interface TelemetryRecord {
  runAt: string;
  durationMs: number;
  stages: {
    gitTracking?: {
      durationMs: number;
      filesScanned: number;
      toProcess: number;
      toDelete: number;
    };
    chunking?: {
      durationMs: number;
      filesProcessed: number;
      chunksGenerated: number;
      errors: number;
    };
    embedding?: EmbeddingStage;
    upload?: { durationMs: number; uploaded: number; deleted: number };
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export async function runReport(dir: string): Promise<void> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    console.error(
      `❌ Could not read telemetry directory "${dir}".\n` +
        `   Run the pipeline first to generate telemetry files.`,
    );
    process.exit(1);
  }

  if (files.length === 0) {
    console.log(`ℹ️  No telemetry files found in "${dir}".`);
    return;
  }

  const records: TelemetryRecord[] = [];
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      records.push(JSON.parse(raw) as TelemetryRecord);
    } catch {
      // Skip malformed files
    }
  }

  if (records.length === 0) {
    console.log("ℹ️  No valid telemetry records found.");
    return;
  }

  // Sort by runAt
  records.sort((a, b) => a.runAt.localeCompare(b.runAt));
  const latest = records[records.length - 1];

  console.log(`\n📊 Observability Report (${records.length} runs)`);
  console.log("─".repeat(50));
  console.log(`  Latest run        : ${latest.runAt}`);
  console.log(`  Total duration    : ${fmt(latest.durationMs)}`);

  const s = latest.stages;
  if (s.gitTracking) {
    console.log(`\n  Git tracking      : ${fmt(s.gitTracking.durationMs)}`);
    console.log(`    Files scanned   : ${s.gitTracking.filesScanned}`);
    console.log(`    To process      : ${s.gitTracking.toProcess}`);
    console.log(`    To delete       : ${s.gitTracking.toDelete}`);
  }

  if (s.chunking) {
    console.log(`\n  Chunking          : ${fmt(s.chunking.durationMs)}`);
    console.log(`    Files processed : ${s.chunking.filesProcessed}`);
    console.log(`    Chunks generated: ${s.chunking.chunksGenerated}`);
    if (s.chunking.errors > 0) {
      console.log(`    Errors          : ${s.chunking.errors}`);
    }
  }

  if (s.embedding) {
    const e = s.embedding;
    const total = e.chunksEmbedded + e.chunksSkipped;
    const hitRate = total > 0 ? e.chunksSkipped / total : 0;
    console.log(`\n  Embedding         : ${fmt(e.durationMs)}`);
    console.log(`    Chunks embedded : ${e.chunksEmbedded}`);
    console.log(
      `    Chunks skipped  : ${e.chunksSkipped} (cache hit rate: ${(hitRate * 100).toFixed(1)}%)`,
    );

    if (e.rateLimitEvents !== undefined && e.rateLimitEvents > 0) {
      console.log(`    Rate limit events: ${e.rateLimitEvents}`);
    }

    if (e.latencySamples && e.latencySamples.length > 0) {
      const sorted = [...e.latencySamples].sort((a, b) => a - b);
      console.log(`    API latency p50 : ${fmt(percentile(sorted, 50))}`);
      console.log(`    API latency p95 : ${fmt(percentile(sorted, 95))}`);
      console.log(`    API latency p99 : ${fmt(percentile(sorted, 99))}`);
    }
  }

  if (s.upload) {
    console.log(`\n  Upload            : ${fmt(s.upload.durationMs)}`);
    console.log(`    Uploaded        : ${s.upload.uploaded}`);
    console.log(`    Deleted         : ${s.upload.deleted}`);
  }

  // Trend across all runs
  if (records.length > 1) {
    const durations = records.map((r) => r.durationMs);
    const avgDuration = durations.reduce((s, v) => s + v, 0) / durations.length;
    console.log(`\n  Average run time  : ${fmt(Math.round(avgDuration))}`);
    console.log(`  Fastest run       : ${fmt(Math.min(...durations))}`);
    console.log(`  Slowest run       : ${fmt(Math.max(...durations))}`);
  }

  console.log("─".repeat(50));
}
