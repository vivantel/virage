import {
  listQualityHistory,
  loadQualityHistoryEntry,
  formatJson,
  formatConsole,
} from "@vivantel/virage-core";
import { createOut } from "../../output.js";

export async function runHistoryList(verbosity: number): Promise<void> {
  const out = createOut(verbosity);
  const entries = await listQualityHistory();

  if (entries.length === 0) {
    out.warn(
      "No quality history found. Run `virage quality --history` to save a run.",
    );
    return;
  }

  out.section("Quality History");
  const header = `${"ID".padEnd(28)} ${"TIMESTAMP".padEnd(25)} ${"SCORE".padEnd(8)} STATUS`;
  out.info(header);
  out.info("─".repeat(header.length));
  for (const e of entries) {
    const scoreStr = `${(e.overallScore * 100).toFixed(1)}%`;
    out.info(
      `${e.id.padEnd(28)} ${e.timestamp.padEnd(25)} ${scoreStr.padEnd(8)} ${e.status}`,
    );
  }
}

export async function runHistoryShow(
  id: string,
  verbosity: number,
): Promise<void> {
  const out = createOut(verbosity);
  const report = await loadQualityHistoryEntry(id);

  if (!report) {
    out.error(`No quality history entry found for id "${id}".`);
    out.info("Run `virage quality history list` to see available runs.");
    process.exit(1);
  }

  if (verbosity > 0) {
    process.stdout.write(formatJson(report));
  } else {
    process.stdout.write(formatConsole(report));
  }
}
