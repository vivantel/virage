import {
  loadConfig,
  loadEvalDataset,
  EvalRunner,
  EcosystemEvaluator,
  printEcosystemEvalResult,
  ExperimentStore,
  makeRunId,
  VirageDb,
  defaultVirageDb,
} from "@vivantel/virage-core";
import { createProgressBar } from "../progress/progress-bar.js";
import type {
  EvalResult,
  ExperimentRun,
  EcosystemEvalDataset,
} from "@vivantel/virage-core";

export interface EvaluateOptions {
  config: string;
  dataset: string;
  withLlmJudge: boolean;
  thresholdMrr?: number;
  ci: boolean;
  suite?: "retrieval" | "ecosystem";
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
  if (opts.suite === "ecosystem") {
    return runEcosystemEval(opts);
  }
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
  const db = new VirageDb(defaultVirageDb());
  try {
    const store = new ExperimentStore(db);
    const run: ExperimentRun = {
      id: makeRunId("eval"),
      name: "eval",
      timestamp: new Date().toISOString(),
      config: { configFile: opts.config, dataset: opts.dataset },
      evalResult,
      perQueryRrScores,
    };
    const runId = await store.save(run);
    console.log(`\n💾 Results saved to virage.db (id: ${runId})`);
  } finally {
    db.close();
  }

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

async function runEcosystemEval(opts: EvaluateOptions): Promise<void> {
  console.log("📂 Loading config for ecosystem eval...");
  const cfg = await loadConfig(opts.config);

  console.log(`📋 Loading ecosystem eval dataset from "${opts.dataset}"...`);
  const rawDataset = JSON.parse(
    await import("fs/promises").then((fs) =>
      fs.readFile(opts.dataset, "utf-8"),
    ),
  ) as EcosystemEvalDataset;
  console.log(`   Retrieval queries : ${rawDataset.retrieval.queries.length}`);
  console.log(`   Skill routing     : ${rawDataset.skillRouting.length}`);
  if (rawDataset.ragas) {
    console.log(`   RAGAS queries     : ${rawDataset.ragas.queries.length}`);
  }

  await cfg.vectorStore.initialize();

  const evaluator = new EcosystemEvaluator(
    cfg.vectorStore,
    cfg.embedder,
    [],
    undefined,
    10,
  );

  console.log("\n🔍 Running ecosystem evaluation...");
  const result = await evaluator.run(rawDataset, {
    config: opts.config,
    dataset: opts.dataset,
  });

  printEcosystemEvalResult(result);

  if (opts.thresholdMrr !== undefined) {
    const passed = result.retrieval.mrr >= opts.thresholdMrr;
    if (passed) {
      console.log(
        `\n✅ MRR gate passed: ${result.retrieval.mrr.toFixed(4)} ≥ ${opts.thresholdMrr}`,
      );
    } else {
      console.error(
        `\n❌ MRR gate FAILED: ${result.retrieval.mrr.toFixed(4)} < ${opts.thresholdMrr}`,
      );
      if (opts.ci) process.exit(1);
    }
  }
}
