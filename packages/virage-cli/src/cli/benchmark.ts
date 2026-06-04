import { loadConfig } from "@vivantel/virage-core";

export interface BenchmarkEmbedderOptions {
  config: string;
  samples: number;
  warmup: number;
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
  const cfg = await loadConfig(opts.config);
  const embedder = cfg.embedder;

  console.log(`\n🔬 Benchmarking embedder: ${embedder.name}`);
  if (embedder.model) console.log(`   Model  : ${embedder.model}`);
  console.log(`   Config : ${opts.config}`);
  console.log(`   Samples: ${opts.samples}  Warmup: ${opts.warmup}\n`);

  // Build sample texts by cycling through SAMPLE_TEXTS
  const texts = Array.from(
    { length: opts.samples },
    (_, i) => SAMPLE_TEXTS[i % SAMPLE_TEXTS.length],
  );

  // Warm-up
  console.log(
    `⏳ Warming up (${opts.warmup} run${opts.warmup !== 1 ? "s" : ""})...`,
  );
  for (let i = 0; i < opts.warmup; i++) {
    await embedder.embed(SAMPLE_TEXTS[0]);
  }

  // Latency phase — embed each text individually
  console.log(`⏱  Running ${opts.samples} individual embeds...`);
  const latencies: number[] = [];
  for (const text of texts) {
    const t0 = performance.now();
    await embedder.embed(text);
    latencies.push(performance.now() - t0);
  }
  latencies.sort((a, b) => a - b);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const singleThroughput = 1000 / p50;

  // Batch phase (conditional)
  let batchTotalMs: number | null = null;
  let batchPerItemMs: number | null = null;
  if (typeof embedder.embedBatch === "function") {
    console.log(`📦 Running batch embed (${opts.samples} items)...`);
    const t0 = performance.now();
    await embedder.embedBatch(texts);
    batchTotalMs = performance.now() - t0;
    batchPerItemMs = batchTotalMs / opts.samples;
  }

  // Get dimensions from a single embed if not exposed directly
  const dims =
    embedder.dimensions > 0
      ? embedder.dimensions
      : (await embedder.embed(SAMPLE_TEXTS[0])).length;

  // Report
  const line = "─".repeat(46);
  console.log(`\n📊 Benchmark Results`);
  console.log(line);
  console.log(`  Provider           : ${embedder.name}`);
  console.log(`  Model              : ${embedder.model ?? "(not specified)"}`);
  console.log(`  Dimensions         : ${dims}`);
  console.log(line);
  console.log(`  Single-embed latency`);
  console.log(`    p50              : ${p50.toFixed(1)} ms`);
  console.log(`    p95              : ${p95.toFixed(1)} ms`);
  console.log(`    p99              : ${p99.toFixed(1)} ms`);
  console.log(
    `    throughput (est) : ${singleThroughput.toFixed(1)} embeds/sec`,
  );
  if (batchPerItemMs !== null && batchTotalMs !== null) {
    console.log(line);
    console.log(`  Batch-embed (${opts.samples} items)`);
    console.log(`    total            : ${batchTotalMs.toFixed(1)} ms`);
    console.log(`    per-item         : ${batchPerItemMs.toFixed(1)} ms`);
    console.log(
      `    throughput (est) : ${(1000 / batchPerItemMs).toFixed(1)} embeds/sec`,
    );
  }
  console.log(line);
}
