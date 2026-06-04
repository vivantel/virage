#!/usr/bin/env node

import { Command } from "commander";
import { config } from "dotenv";
import {
  loadConfig,
  Orchestrator,
  RagError,
  defaultChunksFile,
  defaultEmbeddingsDb,
  getVirageDir,
} from "@vivantel/virage-core";
import type { Logger } from "@vivantel/virage-core";
import { createLogger } from "../logger/index.js";
import { createProgressBar } from "../progress/progress-bar.js";
import type { ProgressBar } from "../progress/progress-bar.js";
import { runInit } from "../cli/init.js";
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

async function runOnce(options: {
  config: string;
  force: boolean;
  noUpload: boolean;
  dryRun: boolean;
  chunksOut?: string;
  embeddingsOut?: string;
  logger: Logger;
}): Promise<void> {
  const cfg = await loadConfig(options.config, options.logger);

  const bars: { chunk: ProgressBar | null; embed: ProgressBar | null; upload: ProgressBar | null } =
    { chunk: null, embed: null, upload: null };

  try {
    const orchestrator = new Orchestrator({
      ...cfg,
      options: {
        ...cfg.options,
        force: options.force || cfg.options?.force,
        skipUpload: options.noUpload || cfg.options?.skipUpload,
        dryRun: options.dryRun || cfg.options?.dryRun,
        chunksFile: options.chunksOut || cfg.options?.chunksFile,
        embeddingsFile: options.embeddingsOut || cfg.options?.embeddingsFile,
        logger: options.logger,
        onChunkProgress: (done, total) => {
          if (!bars.chunk) bars.chunk = createProgressBar("Chunking", total);
          bars.chunk.update(done);
        },
        onEmbedProgress: (done, total) => {
          if (!bars.embed) bars.embed = createProgressBar("Embedding", total);
          bars.embed.update(done);
        },
        onUploadProgress: (done, total) => {
          if (!bars.upload) bars.upload = createProgressBar("Uploading", total);
          bars.upload.update(done);
        },
      },
    });
    await orchestrator.run();
  } finally {
    bars.chunk?.stop();
    bars.embed?.stop();
    bars.upload?.stop();
  }
}

program
  .name("virage")
  .description(
    "RAG pipeline CLI — run 'virage update' to index, or a subcommand for diagnostics",
  )
  .version("2.0.0")
  .option(
    "-v, --verbose",
    "Increase verbosity (stackable: -v, -vv … -vvvvv)",
    (_, prev: number) => prev + 1,
    0,
  )
  .action(() => program.outputHelp());

program
  .command("update")
  .description("Run the RAG indexing pipeline")
  .option("-c, --config <path>", "Path to config file", "./virage.config.json")
  .option("-f, --force", "Force full rebuild", false)
  .option("--no-upload", "Skip upload to vector store")
  .option("--dry-run", "Show what would change without uploading", false)
  .option("--chunks-out <path>", "Output path for chunks.json")
  .option("--embeddings-out <path>", "Output path for embeddings.json")
  .option("--watch", "Re-run pipeline on file changes", false)
  .action(
    async (cmdOpts: {
      config: string;
      force: boolean;
      upload: boolean; // commander inverts --no-upload → upload = false
      dryRun: boolean;
      chunksOut?: string;
      embeddingsOut?: string;
      watch: boolean;
    }) => {
      const verbose = program.opts<{ verbose: number }>().verbose;
      const logger = createLogger(verbose);

      const runOptions = {
        config: cmdOpts.config,
        force: cmdOpts.force,
        noUpload: !cmdOpts.upload,
        dryRun: cmdOpts.dryRun,
        chunksOut: cmdOpts.chunksOut,
        embeddingsOut: cmdOpts.embeddingsOut,
        logger,
      };

      logger.info("🚀 Virage");

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
  .command("validate")
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
  .command("evaluate")
  .description("Evaluate retrieval quality against an eval dataset")
  .option("-c, --config <path>", "Path to config file", "./virage.config.json")
  .option("-d, --dataset <path>", "Eval dataset path", "./eval/queries.json")
  .option("--with-llm-judge", "Enable RAGAS LLM-as-judge metrics")
  .option(
    "--threshold-mrr <n>",
    "Fail if MRR is below this threshold",
    parseFloat,
  )
  .option("--ci", "Exit with code 1 if quality gate fails")
  .action(
    async (opts: {
      config: string;
      dataset: string;
      withLlmJudge: boolean;
      thresholdMrr?: number;
      ci: boolean;
    }) => {
      try {
        await runEvaluate({
          config: opts.config,
          dataset: opts.dataset,
          withLlmJudge: opts.withLlmJudge ?? false,
          thresholdMrr: opts.thresholdMrr,
          ci: opts.ci ?? false,
        });
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command("report")
  .description("Show observability report from telemetry files")
  .option(
    "--dir <path>",
    "Directory containing telemetry.json files",
    getVirageDir(),
  )
  .action(async (opts: { dir: string }) => {
    try {
      await runReport(opts.dir);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("eval-generate")
  .description("Generate an eval dataset from existing chunks")
  .option("--chunks <path>", "Chunks file path", defaultChunksFile())
  .option("--output <path>", "Output dataset path", "./eval/queries.json")
  .option("--include-negatives", "Add negative examples")
  .option(
    "--paraphrase-ratio <n>",
    "Fraction of queries to paraphrase (requires LLM judge)",
    parseFloat,
    0,
  )
  .action(
    async (opts: {
      chunks: string;
      output: string;
      includeNegatives: boolean;
      paraphraseRatio: number;
    }) => {
      try {
        const { readFile } = await import("fs/promises");
        const raw = JSON.parse(await readFile(opts.chunks, "utf-8")) as unknown;
        const chunks = Array.isArray(raw)
          ? raw
          : ((raw as { chunks?: unknown[] }).chunks ?? []);
        const { generateEvalDataset } = await import("@vivantel/virage-core");
        await generateEvalDataset(
          chunks as Parameters<typeof generateEvalDataset>[0],
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

const viz = program.command("viz").description("Visualization tools");
viz
  .command("embeddings")
  .description("Generate a 2D visualization of the embedding space")
  .option("--embeddings <path>", "Embeddings DB path", defaultEmbeddingsDb())
  .option("--output <path>", "Output HTML file", "umap.html")
  .option("--projection <type>", "Projection type: umap or tsne", "umap")
  .action(
    async (opts: {
      embeddings: string;
      output: string;
      projection: string;
    }) => {
      try {
        await runVizEmbeddings({
          dbPath: opts.embeddings,
          output: opts.output,
          projection: opts.projection as "umap" | "tsne",
        });
      } catch (error) {
        handleError(error);
      }
    },
  );

const chunks = program.command("chunks").description("Chunk analysis tools");
chunks
  .command("report")
  .description("Show chunk cohesion report")
  .option("--file <path>", "Chunks file path", defaultChunksFile())
  .action(async (opts: { file: string }) => {
    try {
      await runChunksReport(opts.file);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("dashboard")
  .description("Start a local RAG monitoring dashboard")
  .option("--port <n>", "Port to serve on", parseInt, 3000)
  .option("--chunks <path>", "Chunks file path", defaultChunksFile())
  .option("--embeddings <path>", "Embeddings DB path", defaultEmbeddingsDb())
  .action(
    async (opts: { port: number; chunks: string; embeddings: string }) => {
      try {
        await runDashboard({
          port: opts.port,
          chunksFile: opts.chunks,
          dbPath: opts.embeddings,
        });
      } catch (error) {
        handleError(error);
      }
    },
  );

const benchmark = program
  .command("benchmark")
  .description("Performance benchmarking tools");

benchmark
  .command("embedder")
  .description("Benchmark a local HuggingFace embedding model")
  .option("--model <id>", "HuggingFace model ID", "Xenova/all-MiniLM-L6-v2")
  .option("--device <device>", "'cpu' or 'webgpu'", "cpu")
  .action(async (opts: { model: string; device: string }) => {
    try {
      await runBenchmarkEmbedder({
        model: opts.model,
        device: opts.device as "cpu" | "webgpu",
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

const experiment = program
  .command("experiment")
  .description("Experiment tracking and statistical comparison");

experiment
  .command("run")
  .description("Run an experiment and save results")
  .requiredOption("--name <name>", "Experiment name")
  .option("-c, --config <path>", "Path to config file", "./virage.config.json")
  .option("-d, --dataset <path>", "Eval dataset path", "./eval/queries.json")
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

experiment
  .command("list")
  .description("List saved experiment runs")
  .action(async () => {
    try {
      await runExperimentList();
    } catch (error) {
      handleError(error);
    }
  });

experiment
  .command("compare")
  .description("Compare two experiment runs with bootstrap significance test")
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

program.parse(argv);
