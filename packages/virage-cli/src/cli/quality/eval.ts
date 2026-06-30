import {
  loadConfig,
  loadEvalDataset,
  EvalRunner,
  EcosystemEvaluator,
  printEcosystemEvalResult,
  ExperimentStore,
  makeRunId,
  bootstrapPairedTest,
  VirageDb,
  defaultVirageDb,
} from "@vivantel/virage-core";
import { createProgressBar } from "../../progress/progress-bar.js";
import { createOut } from "../../output.js";
import { withSpinner } from "../../spinner.js";
import type {
  EvalResult,
  ExperimentRun,
  EcosystemEvalDataset,
} from "@vivantel/virage-core";

// ─── eval run ─────────────────────────────────────────────────────────────────

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

// ─── eval save / list / compare (experiment management) ───────────────────────

export interface ExperimentRunOptions {
  name: string;
  config: string;
  dataset: string;
  verbosity?: number;
}

export interface ExperimentCompareOptions {
  baseline: string;
  candidate: string;
  verbosity?: number;
}

export async function runExperimentRun(
  opts: ExperimentRunOptions,
): Promise<void> {
  const out = createOut(opts.verbosity ?? 0);
  out.section(`🧪 Experiment: "${opts.name}"`);

  const cfg = await withSpinner("Loading config", () =>
    loadConfig(opts.config),
  );
  out.info(`Loading eval dataset from "${opts.dataset}"...`);
  const dataset = await loadEvalDataset(opts.dataset);

  await withSpinner("Initializing vector store", () =>
    cfg.vectorStore.initialize(),
  );

  out.info("Running evaluation...");
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

  out.divider();
  out.info(`  MRR: ${evalResult.mrr.toFixed(4)}`);
  out.info(`  Precision@5: ${(evalResult.precisionAt5 * 100).toFixed(1)}%`);
  out.info(`  Recall@10: ${(evalResult.recallAt10 * 100).toFixed(1)}%`);
  out.info(`  HitRate@5: ${(evalResult.hitRateAt5 * 100).toFixed(1)}%`);

  const db = new VirageDb(defaultVirageDb());
  try {
    const store = new ExperimentStore(db);
    const run: ExperimentRun = {
      id: makeRunId(opts.name),
      name: opts.name,
      timestamp: new Date().toISOString(),
      config: { configFile: opts.config, dataset: opts.dataset },
      evalResult,
      perQueryRrScores,
    };
    const runId = await store.save(run);
    out.success(`Experiment "${runId}" saved to virage.db`);
  } finally {
    db.close();
  }
}

export async function runExperimentList(verbosity = 0): Promise<void> {
  const out = createOut(verbosity);
  const db = new VirageDb(defaultVirageDb());
  let runs;
  try {
    const store = new ExperimentStore(db);
    runs = await store.list();
  } finally {
    db.close();
  }

  if (runs.length === 0) {
    out.info(
      "No experiment runs found. Use `virage quality eval save` to create one.",
    );
    return;
  }

  out.section("📋 Experiment Runs");
  out.info(
    `  ${"ID".padEnd(35)} ${"NAME".padEnd(20)} ${"TIMESTAMP".padEnd(20)} MRR`,
  );
  out.divider("─", 80);

  const sorted = [...runs].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  for (const run of sorted) {
    const ts = run.timestamp.slice(0, 19).replace("T", " ");
    out.info(
      `  ${run.id.padEnd(35)} ${run.name.padEnd(20)} ${ts.padEnd(20)} ${run.evalResult.mrr.toFixed(4)}`,
    );
  }

  out.divider("─", 80);
  out.dim(`  ${runs.length} run(s) total`);
}

export async function runExperimentCompare(
  opts: ExperimentCompareOptions,
): Promise<void> {
  const out = createOut(opts.verbosity ?? 0);
  const db = new VirageDb(defaultVirageDb());
  let baseline, candidate;
  try {
    const store = new ExperimentStore(db);
    out.info("Loading experiment runs...");
    baseline = await store.load(opts.baseline);
    candidate = await store.load(opts.candidate);
  } finally {
    db.close();
  }

  out.section("📊 Comparing experiments");
  out.info(
    `  Baseline  : ${baseline.id} (MRR: ${baseline.evalResult.mrr.toFixed(4)})`,
  );
  out.info(
    `  Candidate : ${candidate.id} (MRR: ${candidate.evalResult.mrr.toFixed(4)})`,
  );

  if (!baseline.perQueryRrScores || !candidate.perQueryRrScores) {
    const delta = candidate.evalResult.mrr - baseline.evalResult.mrr;
    out.divider();
    out.info(`  MRR delta  : ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}`);
    out.dim(
      "  Per-query scores unavailable. Re-run experiments to get bootstrap test.",
    );
    out.divider();
    return;
  }

  if (baseline.perQueryRrScores.length !== candidate.perQueryRrScores.length) {
    out.warn(
      `Query count mismatch (${baseline.perQueryRrScores.length} vs ` +
        `${candidate.perQueryRrScores.length}). Using shorter set.`,
    );
  }

  const n = Math.min(
    baseline.perQueryRrScores.length,
    candidate.perQueryRrScores.length,
  );

  if (n < 2) {
    out.warn("Cannot run statistical test: need at least 2 queries.");
    return;
  }

  const stat = bootstrapPairedTest(
    baseline.perQueryRrScores.slice(0, n),
    candidate.perQueryRrScores.slice(0, n),
  );

  const verdict =
    stat.recommendation === "accept"
      ? "✅"
      : stat.recommendation === "reject"
        ? "❌"
        : "⚠️ ";

  out.divider();
  out.info(
    `  MRR delta  : ${stat.mrrDelta >= 0 ? "+" : ""}${stat.mrrDelta.toFixed(4)}`,
  );
  out.info(`  p-value    : ${stat.pValue.toFixed(4)}`);
  out.info(
    `  95% CI     : [${stat.confidenceInterval95[0].toFixed(4)}, ${stat.confidenceInterval95[1].toFixed(4)}]`,
  );
  out.info(`  Verdict    : ${verdict} ${stat.recommendation.toUpperCase()}`);
  out.divider();
}
