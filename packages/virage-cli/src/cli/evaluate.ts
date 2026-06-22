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
import { createOut } from "../output.js";
import { withSpinner } from "../spinner.js";
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
  verbosity?: number;
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printEvalResult(result: EvalResult, verbosity: number): void {
  const out = createOut(verbosity);
  out.section("📊 Retrieval Evaluation Results");
  out.info(`  Queries evaluated : ${result.queriesEvaluated}`);
  out.info(`  Precision@5       : ${formatPercent(result.precisionAt5)}`);
  out.info(`  Precision@10      : ${formatPercent(result.precisionAt10)}`);
  out.info(`  Recall@10         : ${formatPercent(result.recallAt10)}`);
  out.info(`  MRR               : ${result.mrr.toFixed(4)}`);
  out.info(`  HitRate@5         : ${formatPercent(result.hitRateAt5)}`);
  out.divider();
}

export async function runEvaluate(opts: EvaluateOptions): Promise<void> {
  const verbosity = opts.verbosity ?? 0;
  if (opts.suite === "ecosystem") {
    return runEcosystemEval(opts, verbosity);
  }
  const out = createOut(verbosity);

  out.info("Loading config...");
  const cfg = await loadConfig(opts.config);

  out.info(`Loading eval dataset from "${opts.dataset}"...`);
  const dataset = await loadEvalDataset(opts.dataset);
  out.dim(`   Found ${dataset.queries.length} queries`);

  await withSpinner("Initializing vector store", () =>
    cfg.vectorStore.initialize(),
  );

  out.info("Running retrieval evaluation...");
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

  printEvalResult(evalResult, verbosity);

  if (opts.withLlmJudge) {
    out.info(
      "LLM-as-judge (RAGAS) requires a judge configured in config.\n" +
        "   Add a judge to your pipeline config to enable RAGAS metrics.",
    );
  }

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
    out.success(`Results saved to virage.db (id: ${runId})`);
  } finally {
    db.close();
  }

  if (opts.thresholdMrr !== undefined) {
    const passed = evalResult.mrr >= opts.thresholdMrr;
    if (passed) {
      out.success(
        `Quality gate passed: MRR ${evalResult.mrr.toFixed(4)} ≥ ${opts.thresholdMrr}`,
      );
    } else {
      out.error(
        `Quality gate FAILED: MRR ${evalResult.mrr.toFixed(4)} < ${opts.thresholdMrr}`,
      );
      if (opts.ci) process.exit(1);
    }
  }
}

async function runEcosystemEval(
  opts: EvaluateOptions,
  verbosity: number,
): Promise<void> {
  const out = createOut(verbosity);
  out.info("Loading config for ecosystem eval...");
  const cfg = await loadConfig(opts.config);

  out.info(`Loading ecosystem eval dataset from "${opts.dataset}"...`);
  const rawDataset = JSON.parse(
    await import("fs/promises").then((fs) =>
      fs.readFile(opts.dataset, "utf-8"),
    ),
  ) as EcosystemEvalDataset;
  out.dim(`   Retrieval queries : ${rawDataset.retrieval.queries.length}`);
  out.dim(`   Skill routing     : ${rawDataset.skillRouting.length}`);
  if (rawDataset.ragas) {
    out.dim(`   RAGAS queries     : ${rawDataset.ragas.queries.length}`);
  }

  await withSpinner("Initializing vector store", () =>
    cfg.vectorStore.initialize(),
  );

  const evaluator = new EcosystemEvaluator(
    cfg.vectorStore,
    cfg.embedder,
    [],
    undefined,
    10,
  );

  out.info("Running ecosystem evaluation...");
  const result = await evaluator.run(rawDataset, {
    config: opts.config,
    dataset: opts.dataset,
  });

  printEcosystemEvalResult(result);

  if (opts.thresholdMrr !== undefined) {
    const passed = result.retrieval.mrr >= opts.thresholdMrr;
    if (passed) {
      out.success(
        `MRR gate passed: ${result.retrieval.mrr.toFixed(4)} ≥ ${opts.thresholdMrr}`,
      );
    } else {
      out.error(
        `MRR gate FAILED: ${result.retrieval.mrr.toFixed(4)} < ${opts.thresholdMrr}`,
      );
      if (opts.ci) process.exit(1);
    }
  }
}
