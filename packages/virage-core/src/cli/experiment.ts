import { loadConfig } from "../config-loader.js";
import { loadEvalDataset } from "../eval/dataset-io.js";
import { EvalRunner } from "../eval/runner.js";
import { ExperimentStore, makeRunId } from "../eval/experiment-store.js";
import { createProgressBar } from "../progress/progress-bar.js";
import { bootstrapPairedTest } from "../eval/statistics.js";
import type { ExperimentRun } from "../interfaces/quality.js";

export interface ExperimentRunOptions {
  name: string;
  config: string;
  dataset: string;
}

export interface ExperimentCompareOptions {
  baseline: string;
  candidate: string;
}

export async function runExperimentRun(
  opts: ExperimentRunOptions,
): Promise<void> {
  console.log(`🧪 Experiment: "${opts.name}"`);
  console.log("📂 Loading config...");
  const cfg = await loadConfig(opts.config);

  console.log(`📋 Loading eval dataset from "${opts.dataset}"...`);
  const dataset = await loadEvalDataset(opts.dataset);

  await cfg.vectorStore.initialize();

  console.log("🔍 Running evaluation...");
  const runner = new EvalRunner(cfg.vectorStore, cfg.embedder, dataset);
  const evalBar = createProgressBar("Evaluating", dataset.queries.length);
  const { evalResult, perQueryRrScores } = await runner.run((done, total) =>
    evalBar.update(done < total ? done : total),
  );
  evalBar.stop();

  console.log(`\n  MRR: ${evalResult.mrr.toFixed(4)}`);
  console.log(`  Precision@5: ${(evalResult.precisionAt5 * 100).toFixed(1)}%`);
  console.log(`  Recall@10: ${(evalResult.recallAt10 * 100).toFixed(1)}%`);
  console.log(`  HitRate@5: ${(evalResult.hitRateAt5 * 100).toFixed(1)}%`);

  const store = new ExperimentStore();
  const run: ExperimentRun = {
    id: makeRunId(opts.name),
    name: opts.name,
    timestamp: new Date().toISOString(),
    config: { configFile: opts.config, dataset: opts.dataset },
    evalResult,
    perQueryRrScores,
  };

  const savedPath = await store.save(run);
  console.log(`\n💾 Experiment "${run.id}" saved to: ${savedPath}`);
}

export async function runExperimentList(): Promise<void> {
  const store = new ExperimentStore();
  const runs = await store.list();

  if (runs.length === 0) {
    console.log(
      "No experiment runs found. Use `virage experiment run` to create one.",
    );
    return;
  }

  console.log("\n📋 Experiment Runs");
  console.log("─".repeat(80));
  console.log(
    `  ${"ID".padEnd(35)} ${"NAME".padEnd(20)} ${"TIMESTAMP".padEnd(20)} MRR`,
  );
  console.log("─".repeat(80));

  // newest-first
  const sorted = [...runs].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  for (const run of sorted) {
    const ts = run.timestamp.slice(0, 19).replace("T", " ");
    console.log(
      `  ${run.id.padEnd(35)} ${run.name.padEnd(20)} ${ts.padEnd(20)} ${run.evalResult.mrr.toFixed(4)}`,
    );
  }

  console.log("─".repeat(80));
  console.log(`  ${runs.length} run(s) total`);
}

export async function runExperimentCompare(
  opts: ExperimentCompareOptions,
): Promise<void> {
  const store = new ExperimentStore();

  console.log(`📂 Loading experiment runs...`);
  const baseline = await store.load(opts.baseline);
  const candidate = await store.load(opts.candidate);

  console.log(`\n📊 Comparing experiments`);
  console.log("─".repeat(50));
  console.log(
    `  Baseline  : ${baseline.id} (MRR: ${baseline.evalResult.mrr.toFixed(4)})`,
  );
  console.log(
    `  Candidate : ${candidate.id} (MRR: ${candidate.evalResult.mrr.toFixed(4)})`,
  );

  if (!baseline.perQueryRrScores || !candidate.perQueryRrScores) {
    const delta = candidate.evalResult.mrr - baseline.evalResult.mrr;
    console.log("─".repeat(50));
    console.log(`  MRR delta  : ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}`);
    console.log(
      `  ℹ️  Per-query scores unavailable. Re-run experiments to get bootstrap test.`,
    );
    console.log("─".repeat(50));
    return;
  }

  if (baseline.perQueryRrScores.length !== candidate.perQueryRrScores.length) {
    console.warn(
      `⚠️  Query count mismatch (${baseline.perQueryRrScores.length} vs ` +
        `${candidate.perQueryRrScores.length}). Using shorter set.`,
    );
  }

  const n = Math.min(
    baseline.perQueryRrScores.length,
    candidate.perQueryRrScores.length,
  );

  if (n < 2) {
    console.log("\n⚠️  Cannot run statistical test: need at least 2 queries.");
    return;
  }

  const stat = bootstrapPairedTest(
    baseline.perQueryRrScores.slice(0, n),
    candidate.perQueryRrScores.slice(0, n),
  );

  const verdictEmoji =
    stat.recommendation === "accept"
      ? "✅"
      : stat.recommendation === "reject"
        ? "❌"
        : "⚠️ ";

  console.log("─".repeat(50));
  console.log(
    `  MRR delta  : ${stat.mrrDelta >= 0 ? "+" : ""}${stat.mrrDelta.toFixed(4)}`,
  );
  console.log(`  p-value    : ${stat.pValue.toFixed(4)}`);
  console.log(
    `  95% CI     : [${stat.confidenceInterval95[0].toFixed(4)}, ${stat.confidenceInterval95[1].toFixed(4)}]`,
  );
  console.log(
    `  Verdict    : ${verdictEmoji} ${stat.recommendation.toUpperCase()}`,
  );
  console.log("─".repeat(50));
}
