import { statSync } from "node:fs";
import { glob } from "glob";
import { minimatch } from "minimatch";
import type { VectorSearchResult } from "@vivantel/virage-core";
import { loadConfig } from "@vivantel/virage-core";
import { createOut } from "../../output.js";
import { withSpinner } from "../../spinner.js";

// ─── Shared ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ─── Embedder ─────────────────────────────────────────────────────────────────

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
  const avgChars = texts.reduce((s, t) => s + t.length, 0) / texts.length;
  const avgTokens = Math.round(avgChars / 4);
  const singleThroughputTokens = (1000 / p50) * avgTokens;

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
  out.info(
    `    throughput (est) : ${singleThroughputTokens.toFixed(0)} tokens/sec`,
  );
  out.info(`                       (~${avgTokens} tokens/embed)`);
  if (batchPerItemMs !== null && batchTotalMs !== null) {
    const batchThroughputTokens =
      (1000 / (batchPerItemMs as number)) * avgTokens;
    out.divider();
    out.info(`  Batch-embed (${opts.samples} items)`);
    out.info(
      `    total            : ${(batchTotalMs as number).toFixed(1)} ms`,
    );
    out.info(
      `    per-item         : ${(batchPerItemMs as number).toFixed(1)} ms`,
    );
    out.info(
      `    throughput (est) : ${batchThroughputTokens.toFixed(0)} tokens/sec`,
    );
  }
  out.divider();
}

// ─── Chunker ──────────────────────────────────────────────────────────────────

export interface BenchmarkChunkerOptions {
  config: string;
  files: string[];
  samples: number;
  warmup: number;
  verbosity: number;
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

  for (const { chunker } of cfg.fileSetEntries) {
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

// ─── Reranker ─────────────────────────────────────────────────────────────────

export interface BenchmarkRerankerOptions {
  config: string;
  samples: number;
  passages: number;
  warmup: number;
  verbosity: number;
}

const SAMPLE_QUERY = "How does a neural network learn from training data?";

const SAMPLE_PASSAGES = [
  "Neural networks learn by adjusting weights through backpropagation and gradient descent.",
  "A neural network is a series of algorithms that attempt to recognize underlying relationships in data.",
  "Backpropagation computes gradients of the loss function with respect to each weight.",
  "Gradient descent iteratively adjusts weights to minimize the prediction error.",
  "Activation functions introduce non-linearity, enabling networks to model complex patterns.",
  "Overfitting occurs when a model memorizes training data rather than learning generalizable patterns.",
  "Regularization techniques like dropout and L2 penalty reduce overfitting in deep learning models.",
  "Convolutional neural networks are well-suited for image recognition tasks due to spatial invariance.",
  "Recurrent neural networks maintain hidden state, making them effective for sequential data.",
  "Transfer learning applies knowledge from a pre-trained model to a new but related task.",
  "Batch normalization stabilizes learning by normalizing layer inputs during training.",
  "The learning rate controls how large a step the optimizer takes in the parameter space.",
  "Attention mechanisms allow models to focus on relevant parts of the input during inference.",
  "Transformer architecture uses self-attention to process entire sequences in parallel.",
  "Embedding layers map discrete tokens into continuous vector representations.",
  "Loss functions measure the distance between predictions and ground-truth labels.",
  "Epochs refer to how many times the entire training dataset passes through the network.",
  "Mini-batch training balances computational efficiency with gradient estimate quality.",
  "Weight initialization strategies affect convergence speed and training stability.",
  "Early stopping halts training when validation loss stops improving to prevent overfitting.",
];

function makeCandidates(n: number): VectorSearchResult[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `bench-${i}`,
    denseText: SAMPLE_PASSAGES[i % SAMPLE_PASSAGES.length],
    sparseText: SAMPLE_PASSAGES[i % SAMPLE_PASSAGES.length],
    metadata: {},
    similarity: 1 - i * 0.01,
  }));
}

export async function runBenchmarkReranker(
  opts: BenchmarkRerankerOptions,
): Promise<void> {
  const out = createOut(opts.verbosity);
  const cfg = await loadConfig(opts.config);
  const reranker = cfg.search?.reranker;

  if (!reranker) {
    out.warn(
      "No reranker configured in virage.config.json (search.reranker). " +
        "Add a reranker to benchmark it.",
    );
    return;
  }

  const candidates = makeCandidates(opts.passages);
  const avgCharsPerPassage =
    candidates.reduce((s, c) => s + c.denseText.length, 0) / candidates.length;
  const avgTokensPerPassage = Math.round(avgCharsPerPassage / 4);
  const totalTokensPerCall =
    Math.round(SAMPLE_QUERY.length / 4) + avgTokensPerPassage * opts.passages;

  out.section(`🔬 Benchmarking reranker: ${reranker.name}`);
  out.dim(`   Query    : "${SAMPLE_QUERY}"`);
  out.dim(`   Passages : ${opts.passages} per call`);
  out.dim(`   Config   : ${opts.config}`);
  out.dim(`   Samples  : ${opts.samples}  Warmup: ${opts.warmup}`);

  await withSpinner(
    `Warm-up (${opts.warmup} run${opts.warmup !== 1 ? "s" : ""})`,
    async () => {
      for (let i = 0; i < opts.warmup; i++) {
        await reranker.rerank(SAMPLE_QUERY, candidates, opts.passages);
      }
    },
    0,
  );

  const latencies: number[] = [];
  await withSpinner(
    `Running ${opts.samples} rerank calls`,
    async () => {
      for (let i = 0; i < opts.samples; i++) {
        const t0 = performance.now();
        await reranker.rerank(SAMPLE_QUERY, candidates, opts.passages);
        latencies.push(performance.now() - t0);
      }
    },
    0,
  );
  latencies.sort((a, b) => a - b);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const passagesPerSec = opts.passages / (p50 / 1000);
  const tokensPerSec = totalTokensPerCall / (p50 / 1000);

  out.section("📊 Benchmark Results");
  out.info(`  Reranker           : ${reranker.name}`);
  out.info(`  Passages/call      : ${opts.passages}`);
  out.info(`  Est. tokens/call   : ~${totalTokensPerCall}`);
  out.divider();
  out.info(`  Latency (per call)`);
  out.info(`    p50              : ${p50.toFixed(1)} ms`);
  out.info(`    p95              : ${p95.toFixed(1)} ms`);
  out.info(`    p99              : ${p99.toFixed(1)} ms`);
  out.divider();
  out.info(`  Throughput (est)`);
  out.info(`    passages/sec     : ${passagesPerSec.toFixed(1)} passages/sec`);
  out.info(`    tokens/sec       : ${tokensPerSec.toFixed(0)} tokens/sec`);
  out.divider();
}
