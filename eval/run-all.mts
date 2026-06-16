#!/usr/bin/env tsx
/**
 * Orchestrates all Virage eval scripts and writes a combined report.
 * In CI (GITHUB_STEP_SUMMARY set), appends markdown to the job summary.
 * Locally, prints human-readable output to stdout.
 */

import { execSync } from "child_process";
import { appendFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVAL_DIR = join(ROOT, "eval");
const SUMMARY_FILE = process.env["GITHUB_STEP_SUMMARY"];
const CI = !!SUMMARY_FILE;

function run(cmd: string, label: string): { output: string; ok: boolean } {
  if (!CI) console.log(`\nRunning: ${label}...`);
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { output, ok: true };
  } catch (e) {
    const output =
      e instanceof Error && "stdout" in e
        ? String((e as { stdout: unknown }).stdout)
        : String(e);
    return { output, ok: false };
  }
}

function emit(text: string): void {
  if (SUMMARY_FILE) {
    appendFileSync(SUMMARY_FILE, text + "\n");
  } else {
    process.stdout.write(text + "\n");
  }
}

// Clear summary file header in CI
if (SUMMARY_FILE) {
  writeFileSync(SUMMARY_FILE, "# Virage RAG Quality & Efficiency Report\n\n");
}

// ── 1. Hook coverage ──────────────────────────────────────────────────────────
const hookCoverage = run(
  `npx tsx ${join(EVAL_DIR, "hook-coverage.mts")} --summary`,
  "Hook Coverage",
);
emit(hookCoverage.output);
if (!CI && !hookCoverage.ok) console.error("  ⚠️  Hook coverage script failed");

// ── 2. Skill routing ──────────────────────────────────────────────────────────
const skillRouting = run(
  `npx tsx ${join(EVAL_DIR, "skill-routing.mts")} --summary`,
  "Skill Routing",
);
emit(skillRouting.output);
if (!CI && !skillRouting.ok) console.error("  ⚠️  Skill routing script failed");

// ── 3. Token efficiency ───────────────────────────────────────────────────────
const tokenEff = run(
  `npx tsx ${join(EVAL_DIR, "token-efficiency.mts")} --summary`,
  "Token Efficiency",
);
emit(tokenEff.output);
if (!CI && !tokenEff.ok) console.error("  ⚠️  Token efficiency script failed");

// ── 4. RAG retrieval quality (virage evaluate) ────────────────────────────────
const goldenDataset = join(ROOT, "eval", "golden-dataset.json");
const ragEval = run(
  `npx virage evaluate --dataset ${goldenDataset}`,
  "RAG Retrieval Quality",
);

if (ragEval.ok) {
  emit("### RAG Retrieval Quality (P@5 / MRR / R@10)");
  emit("");
  emit("```");
  emit(ragEval.output.trim());
  emit("```");
} else {
  emit("### RAG Retrieval Quality");
  emit("");
  emit(
    "> ⚠️ Skipped — either `virage index` has not run or `eval/golden-dataset.json` does not exist yet.",
  );
  emit("> Run `virage eval-generate --output eval/candidate-dataset.json` and curate `eval/golden-dataset.json` to enable this section.",
  );
}

// ── Summary footer ────────────────────────────────────────────────────────────
const overallOk = hookCoverage.ok && skillRouting.ok;
if (!CI) {
  console.log("\n" + "=".repeat(60));
  console.log(overallOk ? "✓ All required evals passed." : "✗ Some evals failed — see above.");
}

if (!overallOk) process.exit(1);
