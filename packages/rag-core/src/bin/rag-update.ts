#!/usr/bin/env node

import { Command } from "commander";
import { config } from "dotenv";
import { loadConfig } from "../config-loader.js";
import { Orchestrator } from "../core/orchestrator.js";
import { RagError } from "../core/errors.js";
import { runInit } from "../cli/init.js";
import { runValidate } from "../cli/validate.js";

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

program.parse();
