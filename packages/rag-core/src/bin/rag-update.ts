#!/usr/bin/env node

import { Command } from "commander";
import { config } from "dotenv";
import { loadConfig } from "../config-loader.js";
import { Orchestrator } from "../core/orchestrator.js";
import { RagError } from "../core/errors.js";
import { runInit } from "../cli/init.js";
import { runValidate } from "../cli/validate.js";
import { runEvaluate } from "../cli/evaluate.js";
import { runExperimentRun, runExperimentCompare } from "../cli/experiment.js";
import { runBenchmarkEmbedder } from "../cli/benchmark.js";
import { runStoreStats, runStorePerf } from "../cli/store-cmd.js";
import { runReport } from "../cli/report.js";
import { runChunksReport } from "../cli/chunks-report.js";
import { runVizEmbeddings } from "../cli/viz.js";
import { runDashboard } from "../cli/dashboard.js";

config();

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
}): Promise<void> {
  const cfg = await loadConfig(options.config);
  const orchestrator = new Orchestrator({
    ...cfg,
    options: {
      ...cfg.options,
      force: options.force || cfg.options?.force,
      skipUpload: options.noUpload || cfg.options?.skipUpload,
      dryRun: options.dryRun || cfg.options?.dryRun,
      chunksFile: options.chunksOut || cfg.options?.chunksFile,
      embeddingsFile: options.embeddingsOut || cfg.options?.embeddingsFile,
    },
  });
  await orchestrator.run();
}

program
  .name("rag-update")
  .description("Update RAG index with latest changes")
  .version("2.0.0")
  .option("-c, --config <path>", "Path to config file", "./rag.config.ts")
  .option("-f, --force", "Force full rebuild", false)
  .option("--no-upload", "Skip upload to vector store", false)
  .option("--dry-run", "Show what would change without uploading", false)
  .option("--chunks-out <path>", "Output path for chunks.json")
  .option("--embeddings-out <path>", "Output path for embeddings.json")
  .option("--watch", "Re-run pipeline on file changes", false)
  .action(async () => {
    const opts = program.opts<{
      config: string;
      force: boolean;
      upload: boolean; // commander inverts --no-upload → opts.upload = false
      dryRun: boolean;
      chunksOut?: string;
      embeddingsOut?: string;
      watch: boolean;
    }>();

    const runOptions = {
      config: opts.config,
      force: opts.force,
      noUpload: !opts.upload,
      dryRun: opts.dryRun,
      chunksOut: opts.chunksOut,
      embeddingsOut: opts.embeddingsOut,
    };

    console.log("🚀 RAG Update Tool\n");

    try {
      await runOnce(runOptions);
    } catch (error) {
      handleError(error);
    }

    if (!opts.watch) return;

    // Watch mode
    const { default: chokidar } = await import("chokidar");
    const cfg = await loadConfig(opts.config).catch(() => null);
    const patterns: string[] = cfg
      ? cfg.chunkers.flatMap((c) => c.patterns)
      : [];

    const watched = [opts.config, ...patterns];
    console.log("\n👁️  Watching for changes...");

    let debounce: ReturnType<typeof setTimeout> | null = null;
    chokidar
      .watch(watched, { ignoreInitial: true })
      .on("all", (event, path) => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(async () => {
          console.log(
            `\n🔄 Change detected (${event}: ${path}), re-running...\n`,
          );
          try {
            await runOnce(runOptions);
          } catch (error) {
            console.error(
              "❌ Error:",
              error instanceof Error ? error.message : error,
            );
          }
        }, 500);
      });
  });

program
  .command("init")
  .description("Generate a rag.config.ts template interactively")
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
  .option("-c, --config <path>", "Path to config file", "./rag.config.ts")
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
  .option("-c, --config <path>", "Path to config file", "./rag.config.ts")
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
    "./docs/rag",
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
  .option("--chunks <path>", "Chunks file path", "./docs/rag/chunks.json")
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
        const { generateEvalDataset } = await import("../eval/generator.js");
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
  .option(
    "--embeddings <path>",
    "Embeddings file path",
    "./docs/rag/embeddings.json",
  )
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
          embeddingsFile: opts.embeddings,
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
  .option("--file <path>", "Chunks file path", "./docs/rag/chunks.json")
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
  .option("--chunks <path>", "Chunks file path", "./docs/rag/chunks.json")
  .option(
    "--embeddings <path>",
    "Embeddings file path",
    "./docs/rag/embeddings.json",
  )
  .action(
    async (opts: { port: number; chunks: string; embeddings: string }) => {
      try {
        await runDashboard({
          port: opts.port,
          chunksFile: opts.chunks,
          embeddingsFile: opts.embeddings,
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
  .option("-c, --config <path>", "Path to config file", "./rag.config.ts")
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
  .option("-c, --config <path>", "Path to config file", "./rag.config.ts")
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
  .option("-c, --config <path>", "Path to config file", "./rag.config.ts")
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

program.parse();
