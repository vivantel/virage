#!/usr/bin/env tsx
/**
 * Tests skill routing accuracy by replaying the UserPromptSubmit hook
 * against a labeled dataset of (prompt → expected skill) pairs.
 *
 * Intent: given a user prompt, the hook in .claude/settings.json must route
 * to the correct skill and emit its summary. This test runs the REAL hook
 * command so any change to settings.json is reflected automatically — no
 * mocks, no stubs.
 *
 * Exit code: 1 when any test case fails (CI-blocking).
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Two levels up from eval/suites/ → repo root where .claude/settings.json lives
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SETTINGS_PATH = join(REPO_ROOT, ".claude", "settings.json");

interface TestCase {
  prompt: string;
  expectedSkill: string | null;
  description: string;
}

const TEST_CASES: TestCase[] = [
  // planner — implementation planning, task breakdown, sequencing
  { prompt: "plan the implementation of branch-aware RAG", expectedSkill: "planner", description: "planner: 'plan'" },
  { prompt: "break down the refactor into steps", expectedSkill: "planner", description: "planner: 'break down'" },
  { prompt: "what is the roadmap for v2.0?", expectedSkill: "planner", description: "planner: 'roadmap'" },
  { prompt: "sequence the embedding pipeline changes", expectedSkill: "planner", description: "planner: 'sequence'" },
  { prompt: "give me implement steps for the new chunker", expectedSkill: "planner", description: "planner: 'implement steps'" },

  // architect — ADRs, interface design, system design, refactor scoping
  { prompt: "write an ADR for the new vector store", expectedSkill: "architect", description: "architect: 'ADR'" },
  { prompt: "interface design for the new provider", expectedSkill: "architect", description: "architect: 'interface design'" },
  { prompt: "what are the system design trade-offs here?", expectedSkill: "architect", description: "architect: 'system design'" },
  { prompt: "evaluate refactor scope for the embedder API", expectedSkill: "architect", description: "architect: 'refactor scope'" },

  // doc-writer — README, CHANGELOG, documentation
  { prompt: "update the README with the new CLI flags", expectedSkill: "doc-writer", description: "doc-writer: 'README'" },
  { prompt: "write up the CHANGELOG entry for v1.2.1", expectedSkill: "doc-writer", description: "doc-writer: 'CHANGELOG'" },
  { prompt: "document the new config options", expectedSkill: "doc-writer", description: "doc-writer: 'document'" },

  // code-guard — code review, security, audit
  { prompt: "review the auth middleware for security issues", expectedSkill: "code-guard", description: "code-guard: 'review security'" },
  { prompt: "audit the dependencies for vulnerabilities", expectedSkill: "code-guard", description: "code-guard: 'audit vulnerabilities'" },

  // devops — CI/CD, pipelines, deploy, release, GitHub Actions
  { prompt: "fix the failing CI pipeline step", expectedSkill: "devops", description: "devops: 'CI'" },
  { prompt: "update the GitHub Actions workflow for the new node version", expectedSkill: "devops", description: "devops: 'GitHub Actions'" },
  { prompt: "how should we deploy the new release?", expectedSkill: "devops", description: "devops: 'deploy release'" },

  // qa — tests, specs, coverage
  { prompt: "write a test for the new chunker factory", expectedSkill: "qa", description: "qa: 'test'" },
  { prompt: "check test coverage for the embedder module", expectedSkill: "qa", description: "qa: 'coverage'" },
  { prompt: "what spec should this feature satisfy?", expectedSkill: "qa", description: "qa: 'spec'" },

  // true negatives — should produce no hook output
  { prompt: "fix the type error in session-usage.ts", expectedSkill: null, description: "no match: 'fix'" },
  { prompt: "commit this", expectedSkill: null, description: "no match: 'commit'" },
  { prompt: "push it", expectedSkill: null, description: "no match: 'push'" },
  { prompt: "what does this function return?", expectedSkill: null, description: "no match: generic question" },
];

function extractHookCommand(): string {
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as {
    hooks?: { UserPromptSubmit?: Array<{ hooks: Array<{ command: string }> }> };
  };
  const hook = settings.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command;
  if (!hook) throw new Error("UserPromptSubmit hook not found in .claude/settings.json");
  return hook;
}

let _hookFile: string | null = null;

function runHook(hookCommand: string, prompt: string): string {
  if (!_hookFile) {
    _hookFile = join(tmpdir(), `virage-hook-test-${Date.now()}.sh`);
    writeFileSync(_hookFile, hookCommand, { mode: 0o755 });
  }
  try {
    return execSync(`sh ${_hookFile}`, {
      input: prompt,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function cleanupHookFile(): void {
  if (_hookFile) {
    try { unlinkSync(_hookFile); } catch { /* ignore */ }
  }
}

// Maps skill summary heading text → skill directory name
function classifyOutput(output: string): string | null {
  if (output.includes("Skill: Planner")) return "planner";
  if (output.includes("Skill: Architect")) return "architect";
  if (output.includes("Skill: Doc Writer")) return "doc-writer";
  if (output.includes("Skill: Code Guard")) return "code-guard";
  if (output.includes("Skill: DevOps")) return "devops";
  if (output.includes("Skill: QA")) return "qa";
  return null;
}

function run(summaryMode = false): void {
  let hookCommand: string;
  try {
    hookCommand = extractHookCommand();
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  interface Result {
    tc: TestCase;
    got: string | null;
    pass: boolean;
  }

  const results: Result[] = TEST_CASES.map((tc) => {
    const output = runHook(hookCommand, tc.prompt);
    const got = classifyOutput(output);
    return { tc, got, pass: got === tc.expectedSkill };
  });

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const accuracy = ((passed / total) * 100).toFixed(1);
  const failures = results.filter((r) => !r.pass);

  if (summaryMode) {
    console.log("### Skill Routing Accuracy");
    console.log("");
    console.log(`| Metric | Value |`);
    console.log(`|---|---|`);
    console.log(`| Test cases | ${total} |`);
    console.log(`| Passed | ${passed} |`);
    console.log(`| Accuracy | ${accuracy}% |`);
    if (failures.length > 0) {
      console.log("");
      console.log("**Failures:**");
      console.log("");
      for (const { tc, got } of failures) {
        console.log(`- \`${tc.prompt}\` → expected \`${tc.expectedSkill ?? "none"}\`, got \`${got ?? "none"}\``);
      }
    }
  } else {
    console.log("Skill Routing Accuracy");
    console.log("=".repeat(60));
    console.log(`Test cases:  ${total}`);
    console.log(`Passed:      ${passed}`);
    console.log(`Accuracy:    ${accuracy}%`);
    if (failures.length > 0) {
      console.log("");
      console.log("FAILURES:");
      for (const { tc, got } of failures) {
        console.log(`  ✗  ${tc.description}`);
        console.log(`     prompt:   "${tc.prompt}"`);
        console.log(`     expected: ${tc.expectedSkill ?? "none"}`);
        console.log(`     got:      ${got ?? "none"}`);
      }
    } else {
      console.log("\nAll tests passed.");
    }
  }

  cleanupHookFile();
  if (failures.length > 0 && !summaryMode) process.exit(1);
}

const summaryFlag = process.argv.includes("--summary");
run(summaryFlag);
