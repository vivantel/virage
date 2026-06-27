import { statSync } from "node:fs";
import { glob } from "glob";
import { minimatch } from "minimatch";
import { loadConfig } from "@vivantel/virage-core";
import { createOut } from "../output.js";
import { withSpinner } from "../spinner.js";

export interface BenchmarkChunkerOptions {
  config: string;
  files: string[];
  samples: number;
  warmup: number;
  verbosity: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function matchesPattern(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");
  return minimatch(normalized, normalizedPattern, { matchBase: true });
}

async function expandGlobs(patterns: string[]): Promise<string[]> {
  const results = await Promise.all(
    patterns.map((p) => glob(p, { nodir: true })),
  );
  const unique = new Set(results.flat());
  return [...unique].sort();
}

export async function runBenchmarkChunker(
  opts: BenchmarkChunkerOptions,
): Promise<void> {
  const out = createOut(opts.verbosity);
  const cfg = await loadConfig(opts.config);

  out.section(`🔬 Benchmarking chunkers`);
  out.dim(`   Config  : ${opts.config}`);
  out.dim(`   Samples : ${opts.samples}  Warmup: ${opts.warmup}`);

  let resolvedFiles: string[];
  await withSpinner(
    "Resolving file globs",
    async () => {
      resolvedFiles = await expandGlobs(opts.files);
    },
    0,
  );

  out.dim(`   Inputs  : ${opts.files.join(", ")}`);
  out.dim(`   Resolved: ${resolvedFiles!.length} file(s)`);

  if (resolvedFiles!.length === 0) {
    out.warn("No files matched the provided patterns — nothing to benchmark.");
    return;
  }

  for (const { chunker } of cfg.chunkers) {
    const matchedFiles = resolvedFiles!.filter((f) =>
      chunker.patterns.some((p) => matchesPattern(f, p)),
    );

    out.section(`Chunker: ${chunker.name} @ ${chunker.version}`);
    out.dim(`   Patterns: ${chunker.patterns.join(", ")}`);

    if (matchedFiles.length === 0) {
      out.warn(
        `   No matched files — skipping (patterns don't match any resolved file).`,
      );
      continue;
    }

    const totalBytes = matchedFiles.reduce(
      (sum, f) => sum + statSync(f).size,
      0,
    );
    const totalKB = totalBytes / 1024;

    out.dim(
      `   Files   : ${matchedFiles.length} matched (${totalKB.toFixed(1)} KB total)`,
    );

    await withSpinner(
      `Warm-up (${opts.warmup} run${opts.warmup !== 1 ? "s" : ""})`,
      async () => {
        for (let i = 0; i < opts.warmup; i++) {
          for (const f of matchedFiles) {
            await chunker.chunk(f, "benchmark");
          }
        }
      },
      0,
    );

    const latencies: number[] = [];
    let chunkCount = 0;
    await withSpinner(
      `Running ${opts.samples} passes over ${matchedFiles.length} file(s)`,
      async () => {
        for (let i = 0; i < opts.samples; i++) {
          const t0 = performance.now();
          let count = 0;
          for (const f of matchedFiles) {
            const chunks = await chunker.chunk(f, "benchmark");
            count += chunks.length;
          }
          latencies.push(performance.now() - t0);
          if (i === 0) chunkCount = count;
        }
      },
      0,
    );
    latencies.sort((a, b) => a - b);

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const throughputKBs = totalKB / (p50 / 1000);
    const throughputMBs = throughputKBs / 1024;

    out.section("📊 Results");
    out.info(`  Chunker            : ${chunker.name}`);
    out.info(`  Version            : ${chunker.version}`);
    out.info(`  Files benchmarked  : ${matchedFiles.length}`);
    out.info(`  Chunks produced    : ${chunkCount} (first pass)`);
    out.divider();
    out.info(`  Latency (per full pass over all matched files)`);
    out.info(`    p50              : ${p50.toFixed(1)} ms`);
    out.info(`    p95              : ${p95.toFixed(1)} ms`);
    out.info(`    p99              : ${p99.toFixed(1)} ms`);
    out.divider();
    out.info(`  Throughput (est, based on p50)`);
    out.info(`    KB/s             : ${throughputKBs.toFixed(1)} KB/s`);
    out.info(`    MB/s             : ${throughputMBs.toFixed(3)} MB/s`);
    out.divider();
  }
}
