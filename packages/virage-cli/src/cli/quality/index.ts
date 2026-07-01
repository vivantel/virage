import { type Command } from "commander";
import { getVirageDir } from "@vivantel/virage-core";
import { CliTelemetry } from "../../cli-telemetry.js";
import { createOut } from "../../output.js";
import {
  runBenchmarkEmbedder,
  runBenchmarkChunker,
  runBenchmarkReranker,
} from "./bench.js";
import {
  runEvaluate,
  runExperimentRun,
  runExperimentList,
  runExperimentCompare,
} from "./eval.js";
import { runEvalSuite } from "./suite.js";
import { runQualityCheck } from "./check.js";
import { runHistoryList, runHistoryShow } from "./history.js";
import {
  generateEvalDataset,
  VirageDb,
  defaultVirageDb,
  loadConfig,
  loadRagBenchDataset,
  RagBenchEvaluator,
} from "@vivantel/virage-core";

export function registerQualityCommand(
  program: Command,
  handleError: (error: unknown) => never,
): void {
  const getVerbosity = () => program.opts<{ verbose: number }>().verbose ?? 0;

  // ─── virage quality (default: self-assessment) ──────────────────────────────

  const quality = program
    .command("quality")
    .alias("ql")
    .description(
      "Quality system: self-assessment metrics, retrieval eval, performance benchmarks",
    )
    .option(
      "--components",
      "Run pipeline component metrics (default: true)",
      true,
    )
    .option("--benchmark <path>", "Include RAGBench evaluation from this path")
    .option(
      "--benchmark-hf",
      "Run HuggingFace galileo-ai/ragbench evaluation (all 12 subsets)",
      false,
    )
    .option(
      "--benchmark-hf-rows <n>",
      "Max rows per subset for --benchmark-hf",
      (v: string) => parseInt(v, 10),
      50,
    )
    .option(
      "--benchmark-hf-token <token>",
      "HuggingFace API token for --benchmark-hf (optional)",
    )
    .option("--history", "Save result to quality history", false)
    .option("--fail-fast", "Exit 1 on any MUST-PASS threshold violation", false)
    .option("--json", "Output results as JSON", false)
    .option("--markdown", "Output results as Markdown (for PR comments)", false)
    .option(
      "--sample-size <n>",
      "Number of chunks to sample for expensive metrics",
      (v) => parseInt(v, 10),
      500,
    )
    .option(
      "--k <n>",
      "Top-K for retrieval metrics (Self-Recall, Lexical Recall)",
      (v) => parseInt(v, 10),
      10,
    )
    .option("--output <path>", "Write report to file")
    .option(
      "-c, --config <path>",
      "Path to config file",
      "./virage.config.json",
    )
    .action(
      async (opts: {
        components: boolean;
        benchmark?: string;
        benchmarkHf: boolean;
        benchmarkHfRows: number;
        benchmarkHfToken?: string;
        history: boolean;
        failFast: boolean;
        json: boolean;
        markdown: boolean;
        sampleSize: number;
        k: number;
        output?: string;
        config: string;
      }) => {
        const verbose = getVerbosity();
        const t0 = Date.now();
        const tel = await CliTelemetry.fromConfigPath(opts.config);
        tel.start();
        try {
          await runQualityCheck({
            config: opts.config,
            components: opts.components,
            benchmark: opts.benchmark,
            benchmarkHf: opts.benchmarkHf,
            benchmarkHfRows: opts.benchmarkHfRows,
            benchmarkHfToken: opts.benchmarkHfToken,
            history: opts.history,
            failFast: opts.failFast,
            json: opts.json,
            markdown: opts.markdown,
            sampleSize: opts.sampleSize,
            k: opts.k,
            output: opts.output,
            verbosity: verbose,
          });
          tel.record("quality.check", Date.now() - t0, true);
        } catch (error) {
          tel.record("quality.check", Date.now() - t0, false);
          handleError(error);
        }
      },
    );

  // ─── virage quality eval ─────────────────────────────────────────────────────

  const evalCmd = quality
    .command("eval")
    .alias("e")
    .description(
      "Retrieval evaluation: run quality checks, generate datasets, track experiments",
    )
    .action(function () {
      this.help();
    });

  evalCmd
    .command("run")
    .description(
      "Run a one-shot retrieval quality check against an eval dataset",
    )
    .option(
      "-c, --config <path>",
      "Path to config file",
      "./virage.config.json",
    )
    .option(
      "-d, --dataset <path>",
      "Eval dataset path",
      `${getVirageDir()}/eval-dataset.json`,
    )
    .option("--with-llm-judge", "Enable RAGAS LLM-as-judge metrics")
    .option(
      "--threshold-mrr <n>",
      "Fail if MRR is below this threshold",
      parseFloat,
    )
    .option("--ci", "Exit with code 1 if quality gate fails")
    .option(
      "--suite <type>",
      "Evaluation suite: retrieval (default) or ecosystem",
      "retrieval",
    )
    .option(
      "--ragbench <path>",
      "Also run RAGBench evaluation from qrels/JSON file at this path",
    )
    .action(
      async (opts: {
        config: string;
        dataset: string;
        withLlmJudge: boolean;
        thresholdMrr?: number;
        ci: boolean;
        suite: string;
        ragbench?: string;
      }) => {
        const verbose = getVerbosity();
        const t0 = Date.now();
        const tel = await CliTelemetry.fromConfigPath(opts.config);
        tel.start();
        try {
          await runEvaluate({
            config: opts.config,
            dataset: opts.dataset,
            withLlmJudge: opts.withLlmJudge ?? false,
            thresholdMrr: opts.thresholdMrr,
            ci: opts.ci ?? false,
            suite: opts.suite === "ecosystem" ? "ecosystem" : undefined,
            verbosity: verbose,
          });
          // RAGBench evaluation runs alongside the existing dataset eval
          if (opts.ragbench) {
            const out = createOut(verbose);
            out.info(`Running RAGBench evaluation from "${opts.ragbench}"...`);
            const cfg = await loadConfig(opts.config);
            await cfg.vectorStore.initialize();
            const dataset = await loadRagBenchDataset(opts.ragbench);
            const evaluator = new RagBenchEvaluator(
              cfg.vectorStore,
              cfg.embedder,
            );
            const result = await evaluator.evaluate(dataset, 10);
            out.section("RAGBench Results");
            out.info(`  Source            : ${result.datasetSource}`);
            out.info(`  Queries evaluated : ${result.queriesEvaluated}`);
            out.info(
              `  MRR@${result.topK}           : ${(result.mrrAtK * 100).toFixed(2)}%`,
            );
            out.info(
              `  NDCG@${result.topK}          : ${(result.ndcgAtK * 100).toFixed(2)}%`,
            );
            out.info(
              `  Recall@${result.topK}        : ${(result.recallAtK * 100).toFixed(2)}%`,
            );
            out.info(
              `  Precision@${result.topK}     : ${(result.precisionAtK * 100).toFixed(2)}%`,
            );
            out.info(
              `  HitRate@${result.topK}       : ${(result.hitRateAtK * 100).toFixed(2)}%`,
            );
          }
          tel.record("quality.eval.run", Date.now() - t0, true);
        } catch (error) {
          tel.record("quality.eval.run", Date.now() - t0, false);
          handleError(error);
        }
      },
    );

  evalCmd
    .command("generate")
    .alias("gen")
    .description("Generate an eval dataset from existing indexed chunks")
    .option(
      "--output <path>",
      "Output dataset path",
      `${getVirageDir()}/eval-dataset.json`,
    )
    .option("--include-negatives", "Add negative examples")
    .option(
      "--paraphrase-ratio <n>",
      "Fraction of queries to paraphrase (requires LLM judge)",
      parseFloat,
      0,
    )
    .action(
      async (opts: {
        output: string;
        includeNegatives: boolean;
        paraphraseRatio: number;
      }) => {
        try {
          const db = new VirageDb(defaultVirageDb());
          const chunks = db.getAllChunks();
          db.close();
          await generateEvalDataset(
            chunks,
            {
              includeNegatives: opts.includeNegatives ?? false,
              paraphraseRatio: opts.paraphraseRatio,
            },
            opts.output,
          );
        } catch (error) {
          handleError(error);
        }
      },
    );

  evalCmd
    .command("save")
    .description(
      "Run evaluation and save results under a name for later comparison",
    )
    .requiredOption("--name <name>", "Experiment name")
    .option(
      "-c, --config <path>",
      "Path to config file",
      "./virage.config.json",
    )
    .option(
      "-d, --dataset <path>",
      "Eval dataset path",
      `${getVirageDir()}/eval-dataset.json`,
    )
    .action(async (opts: { name: string; config: string; dataset: string }) => {
      const verbose = getVerbosity();
      try {
        await runExperimentRun({
          name: opts.name,
          config: opts.config,
          dataset: opts.dataset,
          verbosity: verbose,
        });
      } catch (error) {
        handleError(error);
      }
    });

  evalCmd
    .command("list")
    .description("List saved evaluation runs")
    .action(async () => {
      const verbose = getVerbosity();
      try {
        await runExperimentList(verbose);
      } catch (error) {
        handleError(error);
      }
    });

  evalCmd
    .command("compare")
    .description(
      "Compare two saved evaluation runs with bootstrap significance test",
    )
    .requiredOption("--baseline <id>", "Baseline run name or id")
    .requiredOption("--candidate <id>", "Candidate run name or id")
    .action(async (opts: { baseline: string; candidate: string }) => {
      const verbose = getVerbosity();
      try {
        await runExperimentCompare({
          baseline: opts.baseline,
          candidate: opts.candidate,
          verbosity: verbose,
        });
      } catch (error) {
        handleError(error);
      }
    });

  // ─── virage quality suite ────────────────────────────────────────────────────

  const suiteCmd = quality
    .command("suite")
    .description(
      "Multi-config evaluation suite: download pre-built archives and compare search strategies",
    )
    .action(function () {
      this.help();
    });

  suiteCmd
    .command("run")
    .description(
      "Run a multi-config eval suite from a declarative suite.json config",
    )
    .requiredOption("--suite <path>", "Path to eval suite config JSON")
    .option("--ci", "Exit with code 1 if the CI quality gate fails", false)
    .option("--json", "Output raw JSON results", false)
    .option("--no-cache", "Re-download archives even if already cached")
    .action(
      async (cmdOpts: {
        suite: string;
        ci: boolean;
        json: boolean;
        cache: boolean;
      }) => {
        try {
          const verbose = getVerbosity();
          await runEvalSuite({
            suite: cmdOpts.suite,
            ci: cmdOpts.ci,
            json: cmdOpts.json,
            noCache: !cmdOpts.cache,
            verbose,
          });
        } catch (error) {
          handleError(error);
        }
      },
    );

  // ─── virage quality bench ────────────────────────────────────────────────────

  const bench = quality
    .command("bench")
    .alias("b")
    .description("Performance benchmarking tools");

  bench
    .command("embedder")
    .alias("e")
    .description(
      "Benchmark any configured embedder (latency p50/p95/p99 + tokens/sec)",
    )
    .option(
      "-c, --config <path>",
      "Path to virage.config.json",
      "./virage.config.json",
    )
    .option(
      "-s, --samples <n>",
      "Number of latency samples",
      (v) => parseInt(v, 10),
      20,
    )
    .option(
      "-w, --warmup <n>",
      "Number of warm-up runs",
      (v) => parseInt(v, 10),
      3,
    )
    .action(
      async (opts: { config: string; samples: number; warmup: number }) => {
        const verbose = getVerbosity();
        try {
          await runBenchmarkEmbedder({
            config: opts.config,
            samples: opts.samples,
            warmup: opts.warmup,
            verbosity: verbose,
          });
        } catch (error) {
          handleError(error);
        }
      },
    );

  bench
    .command("chunker")
    .alias("c")
    .description(
      "Benchmark configured chunkers (latency p50/p95/p99 + KB/s throughput)",
    )
    .argument("<files...>", "File paths or glob patterns to benchmark")
    .option(
      "-c, --config <path>",
      "Path to virage.config.json",
      "./virage.config.json",
    )
    .option(
      "-s, --samples <n>",
      "Number of passes per chunker",
      (v) => parseInt(v, 10),
      20,
    )
    .option(
      "-w, --warmup <n>",
      "Number of warm-up runs",
      (v) => parseInt(v, 10),
      3,
    )
    .action(
      async (
        files: string[],
        opts: { config: string; samples: number; warmup: number },
      ) => {
        const verbose = getVerbosity();
        try {
          await runBenchmarkChunker({
            config: opts.config,
            files,
            samples: opts.samples,
            warmup: opts.warmup,
            verbosity: verbose,
          });
        } catch (error) {
          handleError(error);
        }
      },
    );

  bench
    .command("reranker")
    .alias("r")
    .description(
      "Benchmark configured reranker (latency p50/p95/p99 + passages/sec)",
    )
    .option(
      "-c, --config <path>",
      "Path to virage.config.json",
      "./virage.config.json",
    )
    .option(
      "-s, --samples <n>",
      "Number of rerank calls",
      (v) => parseInt(v, 10),
      20,
    )
    .option(
      "--passages <n>",
      "Passages per rerank call",
      (v) => parseInt(v, 10),
      10,
    )
    .option(
      "-w, --warmup <n>",
      "Number of warm-up runs",
      (v) => parseInt(v, 10),
      3,
    )
    .action(
      async (opts: {
        config: string;
        samples: number;
        passages: number;
        warmup: number;
      }) => {
        const verbose = getVerbosity();
        try {
          await runBenchmarkReranker({
            config: opts.config,
            samples: opts.samples,
            passages: opts.passages,
            warmup: opts.warmup,
            verbosity: verbose,
          });
        } catch (error) {
          handleError(error);
        }
      },
    );

  // ─── virage quality history ───────────────────────────────────────────────────

  const historyCmd = quality
    .command("history")
    .alias("hist")
    .description("View historical quality check runs")
    .action(function () {
      this.help();
    });

  historyCmd
    .command("list")
    .description("List saved quality runs")
    .action(async () => {
      const verbose = getVerbosity();
      try {
        await runHistoryList(verbose);
      } catch (error) {
        handleError(error);
      }
    });

  historyCmd
    .command("show")
    .description("Show a specific quality run")
    .argument("<id>", "Run ID (timestamp prefix)")
    .action(async (id: string) => {
      const verbose = getVerbosity();
      try {
        await runHistoryShow(id, verbose);
      } catch (error) {
        handleError(error);
      }
    });
}
