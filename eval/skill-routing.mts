#!/usr/bin/env tsx
/**
 * Tests skill routing accuracy by replaying the UserPromptSubmit hook
 * against a labeled dataset of (prompt → expected output) pairs.
 *
 * Runs the actual hook bash command via child_process to test the real logic,
 * including the new trailing-? RAG suggestion branch.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS_PATH = join(ROOT, ".claude", "settings.json");

interface TestCase {
  prompt: string;
  expectedKeyword: string | null;
  description: string;
}

const TEST_CASES: TestCase[] = [
  // Planner branch
  { prompt: "plan the implementation of branch-aware RAG", expectedKeyword: "planner", description: "planner: 'plan'" },
  { prompt: "break down the refactor into steps", expectedKeyword: "planner", description: "planner: 'break down'" },
  { prompt: "what is the roadmap for v2.0?", expectedKeyword: "planner", description: "planner: 'roadmap'" },
  { prompt: "sequence the embedding pipeline changes", expectedKeyword: "planner", description: "planner: 'sequence'" },
  { prompt: "give me implement steps for the new chunker", expectedKeyword: "planner", description: "planner: 'implement steps'" },

  // Architect branch
  { prompt: "write an ADR for the new vector store", expectedKeyword: "architect", description: "architect: 'ADR'" },
  { prompt: "interface design for the new provider", expectedKeyword: "architect", description: "architect: 'interface design'" },
  { prompt: "what are the system design trade-offs here?", expectedKeyword: "architect", description: "architect: 'system design'" },
  { prompt: "evaluate refactor scope for the embedder API", expectedKeyword: "architect", description: "architect: 'refactor scope'" },

  // Doc writer branch
  { prompt: "update the README with the new CLI flags", expectedKeyword: "doc_writer", description: "doc_writer: 'README'" },
  { prompt: "write up the CHANGELOG entry for v1.2.1", expectedKeyword: "doc_writer", description: "doc_writer: 'CHANGELOG'" },
  { prompt: "document the new config options", expectedKeyword: "doc_writer", description: "doc_writer: 'document'" },

  // Code guardian branch
  { prompt: "review the auth middleware for security issues", expectedKeyword: "code-guardian", description: "code-guardian: 'review security'" },
  { prompt: "audit the dependencies for vulnerabilities", expectedKeyword: "code-guardian", description: "code-guardian: 'audit vulnerabilities'" },

  // RAG question branch (trailing ?)
  { prompt: "how does the chunking pipeline work?", expectedKeyword: "rag", description: "rag: question (English)" },
  { prompt: "where is the EmbeddingProvider interface defined?", expectedKeyword: "rag", description: "rag: question (English)" },
  { prompt: "comment ça marche?", expectedKeyword: "rag", description: "rag: question (French)" },
  { prompt: "wie funktioniert das?", expectedKeyword: "rag", description: "rag: question (German)" },
  { prompt: "¿cómo funciona el chunker?", expectedKeyword: "rag", description: "rag: question (Spanish)" },
  { prompt: "что такое EvalDataset?", expectedKeyword: "rag", description: "rag: question (Russian)" },

  // True negatives (should produce no hook output)
  { prompt: "fix the type error in session-usage.ts", expectedKeyword: null, description: "no match: 'fix'" },
  { prompt: "commit this", expectedKeyword: null, description: "no match: 'commit'" },
  { prompt: "apply npm fix", expectedKeyword: null, description: "no match: npm command" },
  { prompt: "push it", expectedKeyword: null, description: "no match: 'push'" },
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

function classifyOutput(output: string): string | null {
  if (output.includes("planner")) return "planner";
  if (output.includes("architect")) return "architect";
  if (output.includes("doc_writer")) return "doc_writer";
  if (output.includes("code-guardian")) return "code-guardian";
  if (output.includes("/rag") || output.includes("Question detected")) return "rag";
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
    return { tc, got, pass: got === tc.expectedKeyword };
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
        console.log(`- \`${tc.prompt}\` → expected \`${tc.expectedKeyword ?? "none"}\`, got \`${got ?? "none"}\``);
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
        console.log(`     expected: ${tc.expectedKeyword ?? "none"}`);
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
