import { writeFile } from "fs/promises";
import {
  runQualityAssessment,
  formatJson,
  formatMarkdown,
  formatConsole,
  saveQualityHistory,
  loadConfig,
} from "@vivantel/virage-core";
import { createOut } from "../../output.js";

export interface QualityCheckOptions {
  config: string;
  components: boolean;
  benchmark?: string;
  history: boolean;
  failFast: boolean;
  json: boolean;
  markdown: boolean;
  sampleSize: number;
  k: number;
  output?: string;
  verbosity: number;
}

export async function runQualityCheck(
  opts: QualityCheckOptions,
): Promise<void> {
  const out = createOut(opts.verbosity);

  if (!opts.components) {
    out.warn("--no-components was set: skipping self-assessment.");
    return;
  }

  out.info("Running pipeline self-assessment...");

  const report = await runQualityAssessment({
    configFile: opts.config,
    sampleSize: opts.sampleSize,
    topK: opts.k,
    failFast: opts.failFast,
    ...(opts.benchmark ? { ragBenchPath: opts.benchmark } : {}),
  });

  // Determine output format
  let output: string;
  if (opts.json) {
    output = formatJson(report);
  } else if (opts.markdown) {
    output = formatMarkdown(report);
  } else {
    output = formatConsole(report);
  }

  if (opts.output) {
    await writeFile(
      opts.output,
      opts.json ? output : formatJson(report),
      "utf-8",
    );
    out.success(`Report written to ${opts.output}`);
    // Always show the human-readable table when output is redirected to a file
    // so CI logs capture the metrics regardless of --json / --markdown flags.
    process.stdout.write(formatConsole(report));
  } else {
    process.stdout.write(output);
  }

  if (opts.history) {
    const cfg = await loadConfig(opts.config).catch(() => null);
    const { historyFile, benchmarkFile } = await saveQualityHistory(report, {
      historyDir: cfg?.quality?.history?.dir,
      maxRuns: cfg?.quality?.history?.maxRuns,
    });
    out.success(`History saved: ${historyFile}`);
    out.dim(`Benchmark data: ${benchmarkFile}`);
  }

  if (opts.failFast && report.status === "FAIL") {
    process.exit(1);
  }
}
