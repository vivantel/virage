import { loadConfig } from "@vivantel/virage-core";
import { createOut } from "../output.js";
import { withSpinner } from "../spinner.js";

export interface BenchmarkEmbedderOptions {
  config: string;
  samples: number;
  warmup: number;
  verbosity: number;
}

const SAMPLE_TEXTS = [
  "What is the capital of France?",
  "Explain the concept of machine learning in simple terms.",
  "How does a neural network learn from data?",
  "What are the benefits of using vector databases for search?",
  "Describe the difference between supervised and unsupervised learning.",
];

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export async function runBenchmarkEmbedder(
  opts: BenchmarkEmbedderOptions,
): Promise<void> {
  const out = createOut(opts.verbosity);
  const cfg = await loadConfig(opts.config);
  const embedder = cfg.embedder;

  out.section(`🔬 Benchmarking embedder: ${embedder.name}`);
  if (embedder.model) out.dim(`   Model  : ${embedder.model}`);
  out.dim(`   Config : ${opts.config}`);
  out.dim(`   Samples: ${opts.samples}  Warmup: ${opts.warmup}`);

  const texts = Array.from(
    { length: opts.samples },
    (_, i) => SAMPLE_TEXTS[i % SAMPLE_TEXTS.length],
  );

  await withSpinner(
    `Warm-up (${opts.warmup} run${opts.warmup !== 1 ? "s" : ""})`,
    async () => {
      for (let i = 0; i < opts.warmup; i++) {
        await embedder.embed(SAMPLE_TEXTS[0]);
      }
    },
    0,
  );

  const latencies: number[] = [];
  await withSpinner(
    `Running ${opts.samples} individual embeds`,
    async () => {
      for (const text of texts) {
        const t0 = performance.now();
        await embedder.embed(text);
        latencies.push(performance.now() - t0);
      }
    },
    0,
  );
  latencies.sort((a, b) => a - b);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const singleThroughput = 1000 / p50;

  let batchTotalMs: number | null = null;
  let batchPerItemMs: number | null = null;
  if (typeof embedder.embedBatch === "function") {
    await withSpinner(
      `Running batch embed (${opts.samples} items)`,
      async () => {
        const t0 = performance.now();
        await embedder.embedBatch!(texts);
        batchTotalMs = performance.now() - t0;
        batchPerItemMs = batchTotalMs / opts.samples;
      },
      0,
    );
  }

  const dims =
    embedder.dimensions > 0
      ? embedder.dimensions
      : (await embedder.embed(SAMPLE_TEXTS[0])).length;

  out.section("📊 Benchmark Results");
  out.info(`  Provider           : ${embedder.name}`);
  out.info(`  Model              : ${embedder.model ?? "(not specified)"}`);
  out.info(`  Dimensions         : ${dims}`);
  out.divider();
  out.info(`  Single-embed latency`);
  out.info(`    p50              : ${p50.toFixed(1)} ms`);
  out.info(`    p95              : ${p95.toFixed(1)} ms`);
  out.info(`    p99              : ${p99.toFixed(1)} ms`);
  out.info(`    throughput (est) : ${singleThroughput.toFixed(1)} embeds/sec`);
  if (batchPerItemMs !== null && batchTotalMs !== null) {
    out.divider();
    out.info(`  Batch-embed (${opts.samples} items)`);
    out.info(
      `    total            : ${(batchTotalMs as number).toFixed(1)} ms`,
    );
    out.info(
      `    per-item         : ${(batchPerItemMs as number).toFixed(1)} ms`,
    );
    out.info(
      `    throughput (est) : ${(1000 / (batchPerItemMs as number)).toFixed(1)} embeds/sec`,
    );
  }
  out.divider();
}
