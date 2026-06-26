import { statSync } from "node:fs";
import { loadConfig } from "@vivantel/virage-core";
import { createOut } from "../output.js";
import { withSpinner } from "../spinner.js";

export interface BenchmarkChunkerOptions {
  config: string;
  file: string;
  samples: number;
  warmup: number;
  verbosity: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export async function runBenchmarkChunker(
  opts: BenchmarkChunkerOptions,
): Promise<void> {
  const out = createOut(opts.verbosity);
  const cfg = await loadConfig(opts.config);

  const fileSizeBytes = statSync(opts.file).size;
  const fileSizeKB = fileSizeBytes / 1024;

  out.section(`🔬 Benchmarking chunkers`);
  out.dim(`   File    : ${opts.file} (${fileSizeKB.toFixed(1)} KB)`);
  out.dim(`   Config  : ${opts.config}`);
  out.dim(`   Samples : ${opts.samples}  Warmup: ${opts.warmup}`);

  for (const { chunker } of cfg.chunkers) {
    out.section(`Chunker: ${chunker.name} @ ${chunker.version}`);
    out.dim(`   Patterns: ${chunker.patterns.join(", ")}`);

    await withSpinner(
      `Warm-up (${opts.warmup} run${opts.warmup !== 1 ? "s" : ""})`,
      async () => {
        for (let i = 0; i < opts.warmup; i++) {
          await chunker.chunk(opts.file, "benchmark");
        }
      },
      0,
    );

    const latencies: number[] = [];
    let chunkCount = 0;
    await withSpinner(
      `Running ${opts.samples} chunk passes`,
      async () => {
        for (let i = 0; i < opts.samples; i++) {
          const t0 = performance.now();
          const chunks = await chunker.chunk(opts.file, "benchmark");
          latencies.push(performance.now() - t0);
          if (i === 0) chunkCount = chunks.length;
        }
      },
      0,
    );
    latencies.sort((a, b) => a - b);

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const throughputKBs = fileSizeKB / (p50 / 1000);
    const throughputMBs = throughputKBs / 1024;

    out.section("📊 Results");
    out.info(`  Chunker            : ${chunker.name}`);
    out.info(`  Version            : ${chunker.version}`);
    out.info(`  Chunks produced    : ${chunkCount}`);
    out.divider();
    out.info(`  Latency (per file)`);
    out.info(`    p50              : ${p50.toFixed(1)} ms`);
    out.info(`    p95              : ${p95.toFixed(1)} ms`);
    out.info(`    p99              : ${p99.toFixed(1)} ms`);
    out.divider();
    out.info(`  Throughput (est)`);
    out.info(`    KB/s             : ${throughputKBs.toFixed(1)} KB/s`);
    out.info(`    MB/s             : ${throughputMBs.toFixed(3)} MB/s`);
    out.divider();
  }
}
