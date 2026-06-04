import {
  loadConfig,
  loadEvalDataset,
  EvalRunner,
  ExperimentStore,
  makeRunId,
} from "@vivantel/virage-core";
import { createProgressBar } from "../progress/progress-bar.js";
import type { EvalResult, ExperimentRun } from "@vivantel/virage-core";

export interface EvaluateOptions {
  config: string;
  dataset: string;
  withLlmJudge: boolean;
  thresholdMrr?: number;
  ci: boolean;
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printEvalResult(result: EvalResult): void {
  console.log("\n📊 Retrieval Evaluation Results");
  console.log("─".repeat(40));
  console.log(`  Queries evaluated : ${result.queriesEvaluated}`);
  console.log(`  Precision@5       : ${formatPercent(result.precisionAt5)}`);
  console.log(`  Precision@10      : ${formatPercent(result.precisionAt10)}`);
  console.log(`  Recall@10         : ${formatPercent(result.recallAt10)}`);
  console.log(`  MRR               : ${result.mrr.toFixed(4)}`);
  console.log(`  HitRate@5         : ${formatPercent(result.hitRateAt5)}`);
  console.log("─".repeat(40));
}

export async function runEvaluate(opts: EvaluateOptions): Promise<void> {
  console.log("📂 Loading config...");
  const cfg = await loadConfig(opts.config);

  console.log(`📋 Loading eval dataset from "${opts.dataset}"...`);
  const dataset = await loadEvalDataset(opts.dataset);
  console.log(`   Found ${dataset.queries.length} queries`);

  await cfg.vectorStore.initialize();

  console.log("🔍 Running retrieval evaluation...");
  const runner = new EvalRunner(cfg.vectorStore, cfg.embedder, dataset);
  const evalBar = createProgressBar("Evaluating", dataset.queries.length);
  let evalResult, perQueryRrScores;
  try {
    ({ evalResult, perQueryRrScores } = await runner.run((done, total) =>
      evalBar.update(done < total ? done : total),
    ));
  } finally {
    evalBar.stop();
  }

  printEvalResult(evalResult);

  if (opts.withLlmJudge) {
    console.log(
      "\n⚖️  LLM-as-judge (RAGAS) requires a judge configured in config.",
    );
    console.log(
      "   Add a judge to your pipeline config to enable RAGAS metrics.",
    );
  }

  // Save to experiment store
  const store = new ExperimentStore();
  const run: ExperimentRun = {
    id: makeRunId("eval"),
    name: "eval",
    timestamp: new Date().toISOString(),
    config: { configFile: opts.config, dataset: opts.dataset },
    evalResult,
    perQueryRrScores,
  };
  const savedPath = await store.save(run);
  console.log(`\n💾 Results saved to: ${savedPath}`);

  // CI quality gate
  if (opts.thresholdMrr !== undefined) {
    const passed = evalResult.mrr >= opts.thresholdMrr;
    if (passed) {
      console.log(
        `\n✅ Quality gate passed: MRR ${evalResult.mrr.toFixed(4)} ≥ ${opts.thresholdMrr}`,
      );
    } else {
      console.error(
        `\n❌ Quality gate FAILED: MRR ${evalResult.mrr.toFixed(4)} < ${opts.thresholdMrr}`,
      );
      if (opts.ci) process.exit(1);
    }
  }
}
