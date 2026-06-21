import { readFile, writeFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import type { EvalSuite } from "../interfaces/suite.js";
import type { EvalResult, ExperimentRun } from "../interfaces/quality.js";
import { loadConfig } from "../config-loader.js";
import { loadEvalDataset } from "./dataset-io.js";
import { EvalRunner } from "./runner.js";
import { ExperimentStore, makeRunId } from "./experiment-store.js";
import { bootstrapPairedTest } from "./statistics.js";
import type { StatTestResult } from "./statistics.js";
import { downloadAndExtract } from "./archive.js";
import type { VirageDb } from "../core/virage-db.js";

export interface SuiteVariantResult {
  name: string;
  evalResult: EvalResult;
  perQueryRrScores: number[];
  runId: string;
  /** Comparison against baseline (absent for the baseline variant itself) */
  comparison?: StatTestResult;
}

export interface SuiteResult {
  /** All variants in declaration order */
  variants: SuiteVariantResult[];
  /** The baseline variant result */
  baseline: SuiteVariantResult;
  /** Whether the CI gate passed (always true when no ciGate is configured) */
  ciPassed: boolean;
}

export interface SuiteRunOptions {
  /** Suppress console output when true */
  silent?: boolean;
  /** Re-download archives even if cached */
  noCache?: boolean;
}

export async function runSuite(
  suite: EvalSuite,
  suiteDir: string,
  db: VirageDb,
  opts: SuiteRunOptions = {},
): Promise<SuiteResult> {
  const { silent = false, noCache = false } = opts;
  const log = silent
    ? () => {}
    : (msg: string) => process.stdout.write(msg + "\n");

  const topK = suite.topK ?? 10;
  const datasetPath = resolve(suiteDir, suite.dataset);
  const dataset = await loadEvalDataset(datasetPath);

  log(
    `  dataset: ${suite.dataset}  queries: ${dataset.queries.length}  top-k: ${topK}`,
  );
  log("");

  // ── Step 1: download and extract all unique databases ──────────────────────

  const cacheDir = resolve(suiteDir, suite.cacheDir ?? ".virage/eval-cache");

  log("  Downloading archives...");
  const dbPaths: Record<string, string> = {};

  for (const [dbId, spec] of Object.entries(suite.databases)) {
    const { dir, cached } = await downloadAndExtract(
      spec.url,
      cacheDir,
      spec.sha256,
      noCache,
    );
    dbPaths[dbId] = dir;
    log(`    ✓ ${dbId}${cached ? "  (cached)" : "  (downloaded)"}`);
  }

  log("");
  log("  Running variants...");

  // ── Step 2: run eval for each variant ─────────────────────────────────────

  const store = new ExperimentStore(db);
  const results: SuiteVariantResult[] = [];

  for (const variant of suite.variants) {
    if (variant.skip) {
      log(`    – ${variant.name}  (skipped)`);
      continue;
    }

    const dbPath = dbPaths[variant.database];
    if (!dbPath) {
      throw new Error(
        `Variant "${variant.name}" references unknown database "${variant.database}"`,
      );
    }

    const variantConfigPath = resolve(suiteDir, variant.config);

    // Patch vectorStore.config.uri in a temp config file so that the suite
    // runner can point each variant at its specific pre-built archive without
    // modifying the source config files.
    const rawConfig = JSON.parse(
      await readFile(variantConfigPath, "utf-8"),
    ) as Record<string, unknown>;

    const vectorStore = rawConfig.vectorStore as
      | Record<string, unknown>
      | undefined;
    if (vectorStore) {
      vectorStore.config = {
        ...(vectorStore.config as Record<string, unknown> | undefined),
        uri: dbPath,
      };
    }

    const tmpDir = await mkdtemp(join(tmpdir(), "virage-suite-"));
    const tmpConfigPath = join(tmpDir, "config.json");
    await writeFile(tmpConfigPath, JSON.stringify(rawConfig));

    let cfg;
    try {
      cfg = await loadConfig(tmpConfigPath);
    } finally {
      await unlink(tmpConfigPath);
      // tmpDir cleanup (best-effort)
      await import("fs/promises")
        .then((m) => m.rm(tmpDir, { recursive: true, force: true }))
        .catch(() => {});
    }

    await cfg.vectorStore.initialize();
    try {
      const runner = new EvalRunner(
        cfg.vectorStore,
        cfg.embedder,
        dataset,
        topK,
      );
      const { evalResult, perQueryRrScores } = await runner.run();

      const run: ExperimentRun = {
        id: makeRunId(`suite-${variant.name}`),
        name: `suite:${variant.name}`,
        timestamp: new Date().toISOString(),
        config: {
          configFile: variant.config,
          database: variant.database,
          suiteDataset: suite.dataset,
        },
        evalResult,
        perQueryRrScores,
      };
      const runId = await store.save(run);

      const isBaseline = variant.name === suite.baseline;
      const mrrPct = (evalResult.mrr * 100).toFixed(1);
      const p5Pct = (evalResult.precisionAt5 * 100).toFixed(1);
      const hr5Pct = (evalResult.hitRateAt5 * 100).toFixed(1);
      log(
        `    ✓ ${variant.name.padEnd(24)} MRR=${mrrPct.padStart(5)}%  P@5=${p5Pct.padStart(5)}%  HR@5=${hr5Pct.padStart(5)}%${isBaseline ? "  [baseline]" : ""}`,
      );

      results.push({ name: variant.name, evalResult, perQueryRrScores, runId });
    } finally {
      await cfg.vectorStore.close?.();
    }
  }

  // ── Step 3: bootstrap comparisons vs baseline ──────────────────────────────

  const baselineResult = results.find((r) => r.name === suite.baseline);
  if (!baselineResult) {
    throw new Error(
      `Baseline variant "${suite.baseline}" was not found in results. ` +
        `Check that it is not skipped and its config/database are valid.`,
    );
  }

  log("");
  log(`  vs baseline (${suite.baseline}):`);

  const challengers = results.filter((r) => r.name !== suite.baseline);

  for (const challenger of challengers) {
    const comparison = bootstrapPairedTest(
      baselineResult.perQueryRrScores,
      challenger.perQueryRrScores,
    );
    challenger.comparison = comparison;

    const delta =
      comparison.mrrDelta >= 0
        ? `+${comparison.mrrDelta.toFixed(4)}`
        : comparison.mrrDelta.toFixed(4);
    const ci = `[${comparison.confidenceInterval95[0].toFixed(2)},${comparison.confidenceInterval95[1].toFixed(2)}]`;
    const verdictIcon =
      comparison.recommendation === "accept"
        ? "✅"
        : comparison.recommendation === "reject"
          ? "❌"
          : "⚠️ ";
    log(
      `    ${challenger.name.padEnd(24)} Δ${delta}  p=${comparison.pValue.toFixed(3)}  CI=${ci}  ${verdictIcon} ${comparison.recommendation.toUpperCase()}`,
    );
  }

  // ── Step 4: CI gate ────────────────────────────────────────────────────────

  let ciPassed = true;
  if (suite.ciGate) {
    ciPassed = baselineResult.evalResult.mrr >= suite.ciGate.mrr;
    log("");
    if (ciPassed) {
      log(
        `  ✅ CI gate passed: baseline MRR ${baselineResult.evalResult.mrr.toFixed(4)} ≥ ${suite.ciGate.mrr}`,
      );
    } else {
      log(
        `  ❌ CI gate FAILED: baseline MRR ${baselineResult.evalResult.mrr.toFixed(4)} < ${suite.ciGate.mrr}`,
      );
    }
  }

  return { variants: results, baseline: baselineResult, ciPassed };
}
