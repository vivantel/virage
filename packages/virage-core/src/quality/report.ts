/**
 * Report formatters for QualityReport.
 * Three formats: JSON (machine), Markdown (PR comments), Console (colored table).
 */

import type { QualityReport } from "./interfaces.js";

// ─── JSON ─────────────────────────────────────────────────────────────────────

export function formatJson(report: QualityReport): string {
  return JSON.stringify(report, null, 2);
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

export function formatMarkdown(report: QualityReport): string {
  const statusEmoji = report.status === "PASS" ? "✅" : "❌";
  const scorePercent = (report.overallScore * 100).toFixed(1);

  const lines: string[] = [
    `## ${statusEmoji} Virage Quality Report`,
    ``,
    `**Overall Score:** ${scorePercent}% — **${report.status}**  `,
    `**Timestamp:** ${report.timestamp}  `,
    `**Sample Size:** ${report.sampleSize} chunks | **Top-K:** ${report.topK}`,
    ``,
  ];

  // Must-pass gates
  const failedGates = report.mustPassGates.filter((g) => !g.passed);
  if (failedGates.length > 0) {
    lines.push(`### ⚠️ Must-Pass Failures`);
    lines.push(``);
    lines.push(`| Metric | Value | Threshold | Status |`);
    lines.push(`|--------|-------|-----------|--------|`);
    for (const gate of failedGates) {
      lines.push(
        `| ${gate.metricName} | ${gate.value.toFixed(3)} | >${gate.threshold} | ❌ FAIL |`,
      );
    }
    lines.push(``);
  }

  // Component scores
  lines.push(`### Component Scores`);
  lines.push(``);
  lines.push(`| Component | Score | Status |`);
  lines.push(`|-----------|-------|--------|`);
  for (const comp of report.components) {
    if (comp.skipped) {
      lines.push(`| ${comp.label} | — | ⏭ skipped |`);
    } else {
      const scoreStr = (comp.score * 100).toFixed(1) + "%";
      const emoji = comp.score >= 0.7 ? "🟢" : comp.score >= 0.5 ? "🟡" : "🔴";
      lines.push(`| ${comp.label} | ${scoreStr} | ${emoji} |`);
    }
  }
  lines.push(``);

  // RAGBench results
  if (report.ragBench) {
    const rb = report.ragBench;
    lines.push(`### RAGBench Retrieval Evaluation`);
    lines.push(``);
    lines.push(
      `**Source:** \`${rb.datasetSource}\` — **Queries evaluated:** ${rb.queriesEvaluated} | **K:** ${rb.topK}`,
    );
    lines.push(``);
    lines.push(`| Metric | Score |`);
    lines.push(`|--------|-------|`);
    lines.push(`| MRR@${rb.topK} | ${(rb.mrrAtK * 100).toFixed(2)}% |`);
    lines.push(`| NDCG@${rb.topK} | ${(rb.ndcgAtK * 100).toFixed(2)}% |`);
    lines.push(`| Recall@${rb.topK} | ${(rb.recallAtK * 100).toFixed(2)}% |`);
    lines.push(
      `| Precision@${rb.topK} | ${(rb.precisionAtK * 100).toFixed(2)}% |`,
    );
    lines.push(`| HitRate@${rb.topK} | ${(rb.hitRateAtK * 100).toFixed(2)}% |`);
    lines.push(``);
  }

  // Metric details (collapsed)
  lines.push(`<details>`);
  lines.push(`<summary>Metric Details</summary>`);
  lines.push(``);
  for (const comp of report.components) {
    if (comp.skipped) continue;
    lines.push(`#### ${comp.label}`);
    lines.push(``);
    lines.push(`| Metric | Raw | Normalized | Weight | Status |`);
    lines.push(`|--------|-----|------------|--------|--------|`);
    for (const m of comp.metrics) {
      if (m.skipped) {
        lines.push(
          `| ${m.name} | — | — | ${m.weight} | ⏭ ${m.skipReason ?? "skipped"} |`,
        );
      } else {
        const mustPass = m.mustPass
          ? m.mustPassPassed
            ? " ✅"
            : " ❌ MUST-PASS FAIL"
          : "";
        lines.push(
          `| ${m.name} | ${m.rawValue.toFixed(3)} | ${(m.normalizedValue * 100).toFixed(1)}% | ${m.weight} | —${mustPass} |`,
        );
      }
    }
    lines.push(``);
  }
  lines.push(`</details>`);

  return lines.join("\n");
}

// ─── Console ──────────────────────────────────────────────────────────────────

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function scoreColor(score: number): string {
  if (score >= 0.7) return ansi.green;
  if (score >= 0.5) return ansi.yellow;
  return ansi.red;
}

function bar(score: number, width = 20): string {
  const filled = Math.round(score * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatConsole(report: QualityReport): string {
  const statusColor = report.status === "PASS" ? ansi.green : ansi.red;
  const scorePercent = (report.overallScore * 100).toFixed(1);

  const lines: string[] = [
    "",
    `${ansi.bold}╔════════════════════════════════════════════════════╗${ansi.reset}`,
    `${ansi.bold}║            Virage Quality Report                   ║${ansi.reset}`,
    `${ansi.bold}╚════════════════════════════════════════════════════╝${ansi.reset}`,
    "",
    `  Status      : ${statusColor}${ansi.bold}${report.status}${ansi.reset}`,
    `  Score       : ${scoreColor(report.overallScore)}${scorePercent}%${ansi.reset}  ${bar(report.overallScore)}`,
    `  Sample size : ${report.sampleSize} chunks  |  Top-K: ${report.topK}`,
    `  Duration    : ${report.durationMs}ms`,
    "",
  ];

  // Must-pass failures
  const failedGates = report.mustPassGates.filter((g) => !g.passed);
  if (failedGates.length > 0) {
    lines.push(`  ${ansi.red}${ansi.bold}⚠ Must-Pass Failures${ansi.reset}`);
    for (const gate of failedGates) {
      lines.push(
        `  ${ansi.red}✗ ${gate.metricName}: ${gate.value.toFixed(3)} (threshold: >${gate.threshold})${ansi.reset}`,
      );
    }
    lines.push("");
  }

  // Component table
  lines.push(
    `  ${ansi.bold}${"COMPONENT".padEnd(22)} ${"SCORE".padEnd(8)} BAR${ansi.reset}`,
  );
  lines.push(`  ${"─".repeat(52)}`);

  for (const comp of report.components) {
    if (comp.skipped) {
      lines.push(`  ${comp.label.padEnd(22)} ${ansi.dim}skipped${ansi.reset}`);
      continue;
    }
    const scoreStr = `${(comp.score * 100).toFixed(1)}%`;
    const color = scoreColor(comp.score);
    lines.push(
      `  ${comp.label.padEnd(22)} ${color}${scoreStr.padEnd(8)}${ansi.reset} ${bar(comp.score, 18)}`,
    );

    // Show must-pass metrics inline
    for (const m of comp.metrics) {
      if (m.mustPass && !m.skipped) {
        const icon = m.mustPassPassed ? `${ansi.green}✓` : `${ansi.red}✗`;
        lines.push(
          `  ${ansi.dim}  └─ ${m.name}: ${m.rawValue.toFixed(3)}${ansi.reset} ${icon}${ansi.reset}`,
        );
      }
    }
  }

  lines.push(`  ${"─".repeat(52)}`);
  lines.push(
    `  ${"OVERALL".padEnd(22)} ${scoreColor(report.overallScore)}${scorePercent}%${ansi.reset.padEnd(7 - scorePercent.length)} ${bar(report.overallScore, 18)}`,
  );
  lines.push("");

  // RAGBench section
  if (report.ragBench) {
    const rb = report.ragBench;
    lines.push(
      `  ${ansi.bold}RAGBench — ${rb.datasetSource} (${rb.queriesEvaluated} queries, K=${rb.topK})${ansi.reset}`,
    );
    lines.push(`  ${"─".repeat(52)}`);
    const rbRows: Array<[string, number]> = [
      [`MRR@${rb.topK}`, rb.mrrAtK],
      [`NDCG@${rb.topK}`, rb.ndcgAtK],
      [`Recall@${rb.topK}`, rb.recallAtK],
      [`Precision@${rb.topK}`, rb.precisionAtK],
      [`HitRate@${rb.topK}`, rb.hitRateAtK],
    ];
    for (const [name, val] of rbRows) {
      const valStr = `${(val * 100).toFixed(1)}%`;
      lines.push(
        `  ${name.padEnd(22)} ${scoreColor(val)}${valStr.padEnd(8)}${ansi.reset} ${bar(val, 18)}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
