#!/usr/bin/env node

import { Command } from "commander";
import { config } from "dotenv";
import {
  loadConfig,
  Orchestrator,
  RagError,
  VirageDb,
  defaultVirageDb,
  getVirageDir,
} from "@vivantel/virage-core";
import type { Logger } from "@vivantel/virage-core";
import { createLogger } from "../logger/index.js";
import { PipelineRenderer, ansi } from "../progress/progress-bar.js";
import { runInit } from "../cli/init.js";
import { runUpdate } from "../cli/update.js";
import { runUsage } from "../cli/usage.js";
import { runReadSkillSummary } from "../cli/read-skill-summary.js";
import { runValidate } from "../cli/validate.js";
import { runEvaluate } from "../cli/evaluate.js";
import {
  runExperimentRun,
  runExperimentCompare,
  runExperimentList,
} from "../cli/experiment.js";
import { runBenchmarkEmbedder } from "../cli/benchmark.js";
import { runStoreStats, runStorePerf } from "../cli/store-cmd.js";
import { runReport } from "../cli/report.js";
import { runChunksReport } from "../cli/chunks-report.js";
import { runVizEmbeddings } from "../cli/viz.js";
import { runDashboard } from "../cli/dashboard.js";
import { runCheck } from "../cli/check.js";
import { runQuery } from "../cli/query-cmd.js";
import { runInstallHooks } from "../cli/install-hooks.js";
import {
  runTelemetryStatus,
  runTelemetryOn,
  runTelemetryOff,
  runTelemetryInit,
  runTelemetryPreview,
  runTelemetryFlush,
} from "../cli/telemetry.js";
import { printBanner } from "../cli/banner.js";

config({ quiet: true });

// Expand -vvv etc. into individual -v flags before commander parses
const argv = process.argv.flatMap((arg) =>
  /^-v+$/.test(arg)
    ? arg
        .slice(1)
        .split("")
        .map((c) => `-${c}`)
    : [arg],
);

const program = new Command();

function handleError(error: unknown): never {
  console.error("❌ Error:", error instanceof Error ? error.message : error);
  if (error instanceof RagError && error.suggestion) {
    console.error("   💡", error.suggestion);
  }
  process.exit(1);
}

// Routes log output through PipelineRenderer so messages appear above the live
// section. Verbosity thresholds: verbose=-v, debug=-vv, trace=-vvv, silly=-vvvvv.
class MultiBarLogger implements Logger {
  constructor(
    private readonly inner: Logger,
    private readonly sink: { log(message: string): void },
    private readonly verbosity: number,
  ) {}
  fatal(msg: string, ...args: unknown[]) {
    this.inner.fatal(msg, ...args);
  }
  error(msg: string, ..._args: unknown[]) {
    this.sink.log(`${ansi.boldRed}✕ ${msg}${ansi.reset}\n`);
  }
  warn(msg: string, ..._args: unknown[]) {
    this.sink.log(`${ansi.yellow}⚠ ${msg}${ansi.reset}\n`);
  }
  info(msg: string, ..._args: unknown[]) {
    this.sink.log(`${msg}\n`);
  }
  success(msg: string, ..._args: unknown[]) {
    this.sink.log(`${ansi.green}${msg}${ansi.reset}\n`);
  }
  verbose(msg: string, ..._args: unknown[]) {
    if (this.verbosity >= 1)
      this.sink.log(`${ansi.dim}  ${msg}${ansi.reset}\n`);
  }
  debug(msg: string, ..._args: unknown[]) {
    if (this.verbosity >= 2)
      this.sink.log(`${ansi.dimGray}  [debug] ${msg}${ansi.reset}\n`);
  }
  trace(msg: string, ..._args: unknown[]) {
    if (this.verbosity >= 3)
      this.sink.log(`${ansi.gray}  [trace] ${msg}${ansi.reset}\n`);
  }
  silly(msg: string, ..._args: unknown[]) {
    if (this.verbosity >= 5)
      this.sink.log(`${ansi.gray}  [silly] ${msg}${ansi.reset}\n`);
  }
  withTag(tag: string): Logger {
    return new MultiBarLogger(
      this.inner.withTag(tag),
      this.sink,
      this.verbosity,
    );
  }
}

async function runOnce(options: {
  config: string;
  force: boolean;
  noUpload: boolean;
  dryRun: boolean;
  logger: Logger;
  verbosity: number;
}): Promise<void> {
  const renderer = new PipelineRenderer();
  const pipelineLogger = new MultiBarLogger(
    options.logger,
    renderer,
    options.verbosity,
  );

  try {
    const cfg = await loadConfig(options.config, pipelineLogger);
    const modelName = cfg.embedder.model ?? "embedding model";

    const orchestrator = new Orchestrator({
      ...cfg,
      options: {
        ...cfg.options,
        force: options.force || cfg.options?.force,
        skipUpload: options.noUpload || cfg.options?.skipUpload,
        dryRun: options.dryRun || cfg.options?.dryRun,
        logger: pipelineLogger,
        onScanProgress: (done, total) => {
          renderer.startScanning(total);
          renderer.updateScanning(done, total);
        },
        onPreWarmStart: () => renderer.startModelLoading(modelName),
        onModelProgress: (loaded, total) =>
          renderer.updateModelProgress(loaded, total),
        onPreWarmDone: () => renderer.startPipeline(),
        onChunkProgress: (done, total) => renderer.updateChunk(done, total),
        onEmbedProgress: (done, total) => renderer.updateEmbed(done, total),
        onUploadProgress: (done, total) => renderer.updateUpload(done, total),
        onFileComplete: (done, total) =>
          renderer.updateFileIndexed(done, total),
      },
    });
    await orchestrator.run();
  } finally {
    renderer.stop();
  }
}

program
  .name("virage")
  .description(
    "RAG pipeline CLI — run 'virage index' to index, or a subcommand for diagnostics",
  )
  .version("2.0.0")
  .option(
    "-v, --verbose",
    "Increase verbosity (stackable: -v, -vv … -vvvvv)",
    (_, prev: number) => prev + 1,
    0,
  )
  .option("--no-banner", "Suppress the startup banner")
  .action(() => program.outputHelp());

program.hook("preAction", (_thisCommand, actionCommand) => {
  const { banner } = program.opts<{ banner: boolean }>();
  const { config } = actionCommand.opts<{ config?: string }>();
  printBanner(config, !banner);
});

program
  .command("index")
  .alias("i")
  .description("Run the RAG indexing pipeline")
  .option("-c, --config <path>", "Path to config file", "./virage.config.json")
  .option("-f, --force", "Force full rebuild", false)
  .option("--no-upload", "Skip upload to vector store")
  .option("--dry-run", "Show what would change without uploading", false)
  .option("--watch", "Re-run pipeline on file changes", false)
  .action(
    async (cmdOpts: {
      config: string;
      force: boolean;
      upload: boolean; // commander inverts --no-upload → upload = false
      dryRun: boolean;
      watch: boolean;
    }) => {
      const verbose = program.opts<{ verbose: number }>().verbose;
      const logger = createLogger(verbose);

      const runOptions = {
        config: cmdOpts.config,
        force: cmdOpts.force,
        noUpload: !cmdOpts.upload,
        dryRun: cmdOpts.dryRun,
        logger,
        verbosity: verbose,
      };

      try {
        await runOnce(runOptions);
      } catch (error) {
        handleError(error);
      }

      if (!cmdOpts.watch) return;

      // Watch mode
      const { default: chokidar } = await import("chokidar");
      const cfg = await loadConfig(cmdOpts.config, logger).catch(() => null);
      const patterns: string[] = cfg
        ? cfg.chunkers.flatMap((c) => c.patterns)
        : [];

      const watched = [cmdOpts.config, ...patterns];
      logger.info("👁️  Watching for changes...");

      let debounce: ReturnType<typeof setTimeout> | null = null;
      chokidar
        .watch(watched, { ignoreInitial: true })
        .on("all", (event, path) => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(async () => {
            logger.info(
              `🔄 Change detected (${event}: ${path}), re-running...`,
            );
            try {
              await runOnce(runOptions);
            } catch (error) {
              logger.error(
                error instanceof Error ? error.message : String(error),
              );
            }
          }, 500);
        });
    },
  );

program
  .command("init")
  .description("Generate a virage.config.json template interactively")
  .action(async () => {
    try {
      await runInit();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).name === "ExitPromptError") {
        console.log("\nCancelled.");
        process.exit(0);
      }
      handleError(error);
    }
  });

program
  .command("update")
  .alias("up")
  .description(
    "Update virage ecosystem packages (embedders, chunkers, agent plugins)",
  )
  .action(async () => {
    try {
      await runUpdate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).name === "ExitPromptError") {
        console.log("\nCancelled.");
        process.exit(0);
      }
      handleError(error);
    }
  });

program
  .command("usage")
  .alias("use")
  .description(
    "Show per-prompt token usage for the current Claude Code session",
  )
  .action(async () => {
    try {
      await runUsage();
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("read-skill-summary")
  .alias("skill")
  .description("Print the summary for a named Virage skill")
  .argument("<name>", "Skill name (e.g. planner, architect, doc_writer)")
  .action(async (name: string) => {
    try {
      await runReadSkillSummary(name);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("check")
  .alias("c")
  .description(
    "Validate that the current embedder config matches the stored index",
  )
  .option("-c, --config <path>", "Path to config file", "./virage.config.json")
  .action(async (opts: { config: string }) => {
    try {
      await runCheck({ config: opts.config });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("validate")
  .alias("val")
  .description("Validate config without running the pipeline")
  .option("-c, --config <path>", "Path to config file", "./virage.config.json")
  .action(async (opts: { config: string }) => {
    try {
      await runValidate(opts.config);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("report")
  .alias("r")
  .description("Show observability report from pipeline runs")
  .action(async () => {
    try {
      await runReport();
    } catch (error) {
      handleError(error);
    }
  });

const evalCmd = program
  .command("eval")
  .alias("e")
  .description(
    "Evaluation tools: run quality checks, generate datasets, track experiments",
  )
  .action(function () {
    this.help();
  });

evalCmd
  .command("run")
  .description("Run a one-shot retrieval quality check against an eval dataset")
  .option("-c, --config <path>", "Path to config file", "./virage.config.json")
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
  .action(
    async (opts: {
      config: string;
      dataset: string;
      withLlmJudge: boolean;
      thresholdMrr?: number;
      ci: boolean;
      suite: string;
    }) => {
      try {
        await runEvaluate({
          config: opts.config,
          dataset: opts.dataset,
          withLlmJudge: opts.withLlmJudge ?? false,
          thresholdMrr: opts.thresholdMrr,
          ci: opts.ci ?? false,
          suite: opts.suite === "ecosystem" ? "ecosystem" : undefined,
        });
      } catch (error) {
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
        const { generateEvalDataset } = await import("@vivantel/virage-core");
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
  .option("-c, --config <path>", "Path to config file", "./virage.config.json")
  .option(
    "-d, --dataset <path>",
    "Eval dataset path",
    `${getVirageDir()}/eval-dataset.json`,
  )
  .action(async (opts: { name: string; config: string; dataset: string }) => {
    try {
      await runExperimentRun({
        name: opts.name,
        config: opts.config,
        dataset: opts.dataset,
      });
    } catch (error) {
      handleError(error);
    }
  });

evalCmd
  .command("list")
  .description("List saved evaluation runs")
  .action(async () => {
    try {
      await runExperimentList();
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
    try {
      await runExperimentCompare({
        baseline: opts.baseline,
        candidate: opts.candidate,
      });
    } catch (error) {
      handleError(error);
    }
  });

const viz = program.command("viz").description("Visualization tools");
viz
  .command("embeddings")
  .description("Generate a 2D visualization of the embedding space")
  .option("--output <path>", "Output HTML file", "umap.html")
  .option("--projection <type>", "Projection type: umap or tsne", "umap")
  .action(async (opts: { output: string; projection: string }) => {
    try {
      await runVizEmbeddings({
        dbPath: defaultVirageDb(),
        output: opts.output,
        projection: opts.projection as "umap" | "tsne",
      });
    } catch (error) {
      handleError(error);
    }
  });

const chunks = program.command("chunks").description("Chunk analysis tools");
chunks
  .command("report")
  .description("Show chunk cohesion report")
  .action(async () => {
    try {
      await runChunksReport(defaultVirageDb());
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("dashboard")
  .alias("d")
  .description("Start a local RAG monitoring dashboard")
  .option("--port <n>", "Port to serve on", (v) => parseInt(v, 10), 3000)
  .option("--verbose", "Enable detailed request logging")
  .action(async (opts: { port: number; verbose: boolean }) => {
    try {
      await runDashboard({
        port: opts.port,
        dbPath: defaultVirageDb(),
        verbose: opts.verbose ?? false,
      });
    } catch (error) {
      handleError(error);
    }
  });

const benchmark = program
  .command("benchmark")
  .description("Performance benchmarking tools");

benchmark
  .command("embedder")
  .description(
    "Benchmark any configured embedder (latency p50/p95/p99 + batch throughput)",
  )
  .option(
    "-c, --config <path>",
    "Path to virage.config.json",
    "./virage.config.json",
  )
  .option("--samples <n>", "Number of latency samples", parseInt, 20)
  .option("--warmup <n>", "Number of warm-up runs", parseInt, 3)
  .action(async (opts: { config: string; samples: number; warmup: number }) => {
    try {
      await runBenchmarkEmbedder({
        config: opts.config,
        samples: opts.samples,
        warmup: opts.warmup,
      });
    } catch (error) {
      handleError(error);
    }
  });

const store = program.command("store").description("Vector store diagnostics");

store
  .command("stats")
  .description("Show vector index quality metrics")
  .option("-c, --config <path>", "Path to config file", "./virage.config.json")
  .action(async (opts: { config: string }) => {
    try {
      await runStoreStats({ config: opts.config });
    } catch (error) {
      handleError(error);
    }
  });

store
  .command("perf")
  .description("Show query performance report")
  .option("-c, --config <path>", "Path to config file", "./virage.config.json")
  .option("--timeframe <hours>", "Timeframe in hours", parseInt, 24)
  .action(async (opts: { config: string; timeframe: number }) => {
    try {
      await runStorePerf({
        config: opts.config,
        timeframeHours: opts.timeframe,
      });
    } catch (error) {
      handleError(error);
    }
  });

const telemetry = program
  .command("telemetry")
  .description("Manage telemetry collection settings and data");

telemetry
  .command("status")
  .description("Show telemetry status, buffer size, and endpoint health")
  .action(async () => {
    try {
      await runTelemetryStatus();
    } catch (error) {
      handleError(error);
    }
  });

telemetry
  .command("on")
  .description("Enable telemetry collection")
  .action(async () => {
    try {
      await runTelemetryOn();
    } catch (error) {
      handleError(error);
    }
  });

telemetry
  .command("off")
  .description("Disable telemetry collection and clear local buffer")
  .option(
    "--tiers <name>",
    "Disable only a specific tier (e.g. explicit_feedback)",
  )
  .action(async (opts: { tiers?: string }) => {
    try {
      await runTelemetryOff({ tiers: opts.tiers });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).name === "ExitPromptError") {
        console.log("\nCancelled.");
        process.exit(0);
      }
      handleError(error);
    }
  });

telemetry
  .command("init")
  .description("Interactive telemetry configuration wizard")
  .action(async () => {
    try {
      await runTelemetryInit();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).name === "ExitPromptError") {
        console.log("\nCancelled.");
        process.exit(0);
      }
      handleError(error);
    }
  });

telemetry
  .command("preview")
  .description(
    "Preview the telemetry payload that would be sent (no transmission)",
  )
  .action(async () => {
    try {
      await runTelemetryPreview();
    } catch (error) {
      handleError(error);
    }
  });

telemetry
  .command("flush")
  .description("Flush buffered telemetry to the configured endpoint")
  .option("--dry-run", "Preview payload without transmitting", false)
  .action(async (opts: { dryRun: boolean }) => {
    try {
      await runTelemetryFlush({ dryRun: opts.dryRun });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("query")
  .alias("q")
  .description("Semantic search over the indexed knowledge base")
  .argument("<text>", "Search query text")
  .option("-c, --config <path>", "Path to config file", "./virage.config.json")
  .option(
    "-k, --top-k <number>",
    "Number of results to return",
    (v) => parseInt(v, 10),
    5,
  )
  .option("--branch <name>", "Filter results to a specific git branch")
  .option("--json", "Output results as JSON", false)
  .option(
    "--hybrid",
    "Enable BM25 + vector hybrid search (overrides config)",
    false,
  )
  .option(
    "--hybrid-alpha <number>",
    "Hybrid blend: 0 = pure BM25, 1 = pure vector (default: 0.6)",
    (v) => parseFloat(v),
  )
  .option(
    "--rerank",
    "Re-rank results with a cross-encoder (requires @vivantel/virage-reranker-cross-encoder)",
    false,
  )
  .action(
    async (
      queryText: string,
      cmdOpts: {
        config: string;
        topK: number;
        branch?: string;
        json: boolean;
        hybrid: boolean;
        hybridAlpha?: number;
        rerank: boolean;
      },
    ) => {
      try {
        await runQuery(queryText, {
          config: cmdOpts.config,
          topK: cmdOpts.topK,
          branch: cmdOpts.branch,
          json: cmdOpts.json,
          hybrid: cmdOpts.hybrid || undefined,
          hybridAlpha: cmdOpts.hybridAlpha,
          rerank: cmdOpts.rerank || undefined,
        });
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command("install-hooks")
  .alias("hooks")
  .description(
    "Install git lifecycle hooks (post-merge, post-checkout) to auto-index on pull/branch switch",
  )
  .option("--uninstall", "Remove Virage-added hooks", false)
  .option("--git-dir <path>", "Path to .git directory (defaults to ./.git)")
  .action(async (cmdOpts: { uninstall: boolean; gitDir?: string }) => {
    try {
      await runInstallHooks({
        uninstall: cmdOpts.uninstall,
        gitDir: cmdOpts.gitDir,
      });
    } catch (error) {
      handleError(error);
    }
  });

program.parse(argv);
