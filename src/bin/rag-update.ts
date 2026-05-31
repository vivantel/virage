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

program
  .name("rag-update")
  .description("Update RAG index with latest changes")
  .version("1.0.0")
  .option("-c, --config <path>", "Path to config file", "./rag.config.ts")
  .option("-f, --force", "Force full rebuild", false)
  .option("--skip-upload", "Skip upload to vector store", false)
  .option("--dry-run", "Show what would change without uploading", false)
  .option("--chunks-file <path>", "Output path for chunks.json")
  .option("--embeddings-file <path>", "Output path for embeddings.json")
  .action(async () => {
    const options = program.opts<{
      config: string;
      force: boolean;
      skipUpload: boolean;
      dryRun: boolean;
      chunksFile?: string;
      embeddingsFile?: string;
    }>();

    console.log("🚀 RAG Update Tool\n");

    try {
      const cfg = await loadConfig(options.config);
      const orchestrator = new Orchestrator({
        ...cfg,
        options: {
          ...cfg.options,
          force: options.force || cfg.options?.force,
          skipUpload: options.skipUpload || cfg.options?.skipUpload,
          dryRun: options.dryRun || cfg.options?.dryRun,
          chunksFile: options.chunksFile || cfg.options?.chunksFile,
          embeddingsFile: options.embeddingsFile || cfg.options?.embeddingsFile,
        },
      });
      await orchestrator.run();
    } catch (error) {
      console.error(
        "❌ Error:",
        error instanceof Error ? error.message : error,
      );
      if (error instanceof RagError && error.suggestion) {
        console.error("   💡", error.suggestion);
      }
      process.exit(1);
    }
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
      console.error(
        "❌ Error:",
        error instanceof Error ? error.message : error,
      );
      process.exit(1);
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
      console.error(
        "❌ Error:",
        error instanceof Error ? error.message : error,
      );
      if (error instanceof RagError && error.suggestion) {
        console.error("   💡", error.suggestion);
      }
      process.exit(1);
    }
  });

program.parse();
