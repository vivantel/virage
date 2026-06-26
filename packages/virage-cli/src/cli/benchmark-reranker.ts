import type { VectorSearchResult } from "@vivantel/virage-core";
import { loadConfig } from "@vivantel/virage-core";
import { createOut } from "../output.js";
import { withSpinner } from "../spinner.js";

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

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

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
