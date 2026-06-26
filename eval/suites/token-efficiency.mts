#!/usr/bin/env tsx
/**
 * Measures the token-cost gap between reading full source files vs using
 * the virage MCP (or CLI equivalent) for the same queries.
 *
 * "Without MCP" scenario: Claude would read the full source files that contain
 * the answer. Token estimate = sum of those files' byte lengths / 4.
 *
 * "With MCP" scenario: Claude calls the virage `search` tool and receives
 * targeted chunks. Token estimate = size of the JSON query response / 4.
 *
 * Source files for the "without MCP" denominator are NOT hardcoded — they are
 * extracted from the actual virage query results, so the comparison is honest:
 * both sides reference the same content, just at different granularity.
 *
 * Requires `virage index` to have been run.
 * Set VIRAGE_BIN to override the binary (e.g. ./virage-runner/node_modules/.bin/virage).
 * Set VIRAGE_CONFIG to override the config file (default: virage.config.ci.json).
 */

import { statSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Two levels up from eval/suites/ → repo root
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const VIRAGE_BIN = process.env.VIRAGE_BIN ?? "virage";
const VIRAGE_CONFIG = process.env.VIRAGE_CONFIG ?? "virage.config.ci.json";

interface QueryCase {
  label: string;
  query: string;
  topK: number;
}

// Representative developer queries that virage MCP is expected to answer well.
// Each maps to real documentation/source content in the repo.
const QUERIES: QueryCase[] = [
  { label: "Custom chunker config (ADR-038 package format)", query: "configure chunker package include ignore patterns ADR", topK: 5 },
  { label: "Orchestrator embed pipeline flow", query: "orchestrator embed pipeline chunk process sequence", topK: 5 },
  { label: "LanceDB schema migration drop recreate", query: "LanceDB schema migration drop table recreate", topK: 5 },
  { label: "Embedder retry batch concurrent options", query: "embedder retry batch size concurrent config", topK: 5 },
  { label: "GitTracker file routing to chunker", query: "GitTracker file routing chunker selection pattern", topK: 5 },
];

interface QueryResult {
  source_file: string;
  [key: string]: unknown;
}

interface QueryMeasurement {
  label: string;
  ragTokens: number;
  sourceFiles: string[];
  noMcpTokens: number;
}

function runQuery(query: string, topK: number): { ragTokens: number; sourceFiles: string[] } {
  try {
    const out = execSync(
      `${VIRAGE_BIN} query ${JSON.stringify(query)} --top-k ${topK} --json --config ${VIRAGE_CONFIG}`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], cwd: REPO_ROOT },
    );
    const results = JSON.parse(out) as QueryResult[];
    const ragTokens = Math.ceil(out.length / 4);
    const sourceFiles = [...new Set(results.map((r) => r.source_file).filter(Boolean))];
    return { ragTokens, sourceFiles };
  } catch {
    return { ragTokens: 0, sourceFiles: [] };
  }
}

function fileTokens(relativePath: string): number {
  try {
    const s = statSync(join(REPO_ROOT, relativePath));
    return Math.ceil(s.size / 4);
  } catch {
    return 0;
  }
}

function run(summaryMode = false): void {
  const measurements: QueryMeasurement[] = QUERIES.map((q) => {
    const { ragTokens, sourceFiles } = runQuery(q.query, q.topK);
    const noMcpTokens = sourceFiles.reduce((sum, sf) => sum + fileTokens(sf), 0);
    return { label: q.label, ragTokens, sourceFiles, noMcpTokens };
  });

  const totalRag = measurements.reduce((s, m) => s + m.ragTokens, 0);
  const totalNoMcp = measurements.reduce((s, m) => s + m.noMcpTokens, 0);
  const totalSaved = totalNoMcp - totalRag;
  const totalPct = totalNoMcp > 0 ? ((totalSaved / totalNoMcp) * 100).toFixed(1) + "%" : "—";

  const indexNotBuilt = totalRag === 0;

  if (summaryMode) {
    console.log("### Token Efficiency: With vs Without Virage MCP");
    console.log("");
    console.log("Token estimate = bytes / 4 (chars-per-token approximation).");
    console.log('"No MCP" = reading the actual source files returned by each query.');
    console.log('"With MCP" = receiving the targeted RAG chunks as JSON.');
    console.log("");
    console.log("| Query | No MCP (full files) | With MCP (chunks) | Saved | % |");
    console.log("|---|---|---|---|---|");
    for (const m of measurements) {
      const saved = m.noMcpTokens - m.ragTokens;
      const pct = m.noMcpTokens > 0 ? ((saved / m.noMcpTokens) * 100).toFixed(1) + "%" : "—";
      const sourceFileList = m.sourceFiles.length > 0
        ? ` (${m.sourceFiles.length} file${m.sourceFiles.length > 1 ? "s" : ""})`
        : "";
      console.log(
        `| ${m.label}${sourceFileList} | ${m.noMcpTokens.toLocaleString()} | ${m.ragTokens.toLocaleString()} | ${saved.toLocaleString()} | ${pct} |`,
      );
    }
    console.log(
      `| **TOTAL** | **${totalNoMcp.toLocaleString()}** | **${totalRag.toLocaleString()}** | **${totalSaved.toLocaleString()}** | **${totalPct}** |`,
    );
    if (indexNotBuilt) {
      console.log("");
      console.log("> ⚠️ RAG tokens = 0 for all queries. Run `virage index` first.");
    }
  } else {
    const cols = [46, 22, 14, 10, 8];
    const headers = ["Query", "No MCP (full files)", "With MCP", "Saved", "%"];
    const line = headers.map((h, i) => h.padEnd(cols[i]!)).join("  ");
    const sep = "=".repeat(line.length);
    console.log("Token Efficiency: With vs Without Virage MCP");
    console.log(sep);
    console.log(line);
    console.log("-".repeat(line.length));
    for (const m of measurements) {
      const saved = m.noMcpTokens - m.ragTokens;
      const pct = m.noMcpTokens > 0 ? ((saved / m.noMcpTokens) * 100).toFixed(1) + "%" : "—";
      const srcNote = m.sourceFiles.length > 0 ? ` [${m.sourceFiles.length}f]` : "";
      console.log(
        [
          (m.label + srcNote).slice(0, cols[0]! - 1).padEnd(cols[0]!),
          m.noMcpTokens.toLocaleString().padEnd(cols[1]!),
          m.ragTokens.toLocaleString().padEnd(cols[2]!),
          saved.toLocaleString().padEnd(cols[3]!),
          pct,
        ].join("  "),
      );
    }
    console.log("-".repeat(line.length));
    console.log(
      [
        "TOTAL".padEnd(cols[0]!),
        totalNoMcp.toLocaleString().padEnd(cols[1]!),
        totalRag.toLocaleString().padEnd(cols[2]!),
        totalSaved.toLocaleString().padEnd(cols[3]!),
        totalPct,
      ].join("  "),
    );
    if (indexNotBuilt) {
      console.log("\nERROR: RAG tokens = 0 for all queries — run `virage index` first.");
      process.exit(1);
    }
  }
}

const summaryFlag = process.argv.includes("--summary");
run(summaryFlag);
