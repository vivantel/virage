#!/usr/bin/env tsx
/**
 * Compares the token cost of reading full files (old skill checklists)
 * vs retrieving targeted RAG results (new RAG-first checklists).
 *
 * File token estimate: file_bytes / 4  (chars-per-token approximation)
 * RAG token estimate:  JSON result bytes / 4
 *
 * Requires `virage index` to have run (will gracefully report 0 RAG tokens if not).
 */

import { statSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface ReplacedRead {
  label: string;
  filePath: string;
  ragQuery: string;
  ragTopK: number;
  skill: string;
}

const REPLACED_READS: ReplacedRead[] = [
  {
    label: "docs/ADR.md (architect)",
    filePath: join(ROOT, "docs", "ADR.md"),
    ragQuery: "ADR architecture decision",
    ragTopK: 3,
    skill: "architect",
  },
  {
    label: "docs/ADR.md (planner)",
    filePath: join(ROOT, "docs", "ADR.md"),
    ragQuery: "ADR trade-off decision",
    ragTopK: 3,
    skill: "planner",
  },
  {
    label: "docs/ai/INDEX.md (planner)",
    filePath: join(ROOT, "docs", "ai", "INDEX.md"),
    ragQuery: "cross-cutting rules commit ADR import style",
    ragTopK: 3,
    skill: "planner",
  },
  {
    label: "packages/virage-core/src/interfaces/ (architect)",
    filePath: join(ROOT, "packages", "virage-core", "src", "interfaces"),
    ragQuery: "interface signature EmbeddingProvider VectorStore",
    ragTopK: 5,
    skill: "architect",
  },
];

function fileTokens(filePath: string): number {
  try {
    const s = statSync(filePath);
    if (s.isDirectory()) {
      // Sum sizes of all .ts files in the directory (one level)
      return readdirSync(filePath)
        .filter((f) => f.endsWith(".ts"))
        .reduce((sum, f) => {
          try {
            return sum + Math.ceil(statSync(join(filePath, f)).size / 4);
          } catch {
            return sum;
          }
        }, 0);
    }
    return Math.ceil(s.size / 4);
  } catch {
    return 0;
  }
}

function ragTokens(query: string, topK: number): number {
  try {
    const out = execSync(
      `npx virage query ${JSON.stringify(query)} --top-k ${topK} --json`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], cwd: ROOT },
    );
    return Math.ceil(out.length / 4);
  } catch {
    return 0;
  }
}

interface Row {
  label: string;
  skill: string;
  fileTok: number;
  ragTok: number;
  saved: number;
  pct: string;
}

function run(summaryMode = false): void {
  const rows: Row[] = REPLACED_READS.map((r) => {
    const fileTok = fileTokens(r.filePath);
    const rt = ragTokens(r.ragQuery, r.ragTopK);
    const saved = fileTok - rt;
    const pct = fileTok > 0 ? ((saved / fileTok) * 100).toFixed(1) + "%" : "—";
    return { label: r.label, skill: r.skill, fileTok, ragTok: rt, saved, pct };
  });

  const totalFileTok = rows.reduce((s, r) => s + r.fileTok, 0);
  const totalRagTok = rows.reduce((s, r) => s + r.ragTok, 0);
  const totalSaved = totalFileTok - totalRagTok;
  const totalPct =
    totalFileTok > 0 ? ((totalSaved / totalFileTok) * 100).toFixed(1) + "%" : "—";

  if (summaryMode) {
    console.log("### Token Efficiency Delta");
    console.log("");
    console.log("| Read replaced | Skill | File tokens | RAG tokens | Saved | % |");
    console.log("|---|---|---|---|---|---|");
    for (const r of rows) {
      console.log(
        `| ${r.label} | ${r.skill} | ${r.fileTok.toLocaleString()} | ${r.ragTok.toLocaleString()} | ${r.saved.toLocaleString()} | ${r.pct} |`,
      );
    }
    console.log(
      `| **TOTAL** | | **${totalFileTok.toLocaleString()}** | **${totalRagTok.toLocaleString()}** | **${totalSaved.toLocaleString()}** | **${totalPct}** |`,
    );
    if (totalRagTok === 0) {
      console.log("");
      console.log(
        "> ⚠️ RAG tokens = 0 — run `virage index` first to populate the knowledge base.",
      );
    }
  } else {
    const col = [50, 12, 12, 12, 10, 8];
    const h = ["Read replaced", "Skill", "File tok", "RAG tok", "Saved", "%"];
    const line = h.map((s, i) => s.padEnd(col[i]!)).join("  ");
    console.log("Token Efficiency Delta");
    console.log("=".repeat(line.length));
    console.log(line);
    console.log("-".repeat(line.length));
    for (const r of rows) {
      console.log(
        [
          r.label.padEnd(col[0]!),
          r.skill.padEnd(col[1]!),
          r.fileTok.toLocaleString().padEnd(col[2]!),
          r.ragTok.toLocaleString().padEnd(col[3]!),
          r.saved.toLocaleString().padEnd(col[4]!),
          r.pct,
        ].join("  "),
      );
    }
    console.log("-".repeat(line.length));
    console.log(
      [
        "TOTAL".padEnd(col[0]!),
        "".padEnd(col[1]!),
        totalFileTok.toLocaleString().padEnd(col[2]!),
        totalRagTok.toLocaleString().padEnd(col[3]!),
        totalSaved.toLocaleString().padEnd(col[4]!),
        totalPct,
      ].join("  "),
    );
    if (totalRagTok === 0) {
      console.log("\nNote: RAG tokens = 0 — run `virage index` first.");
    }
  }
}

const summaryFlag = process.argv.includes("--summary");
run(summaryFlag);
