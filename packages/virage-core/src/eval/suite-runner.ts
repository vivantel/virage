import { createHash } from "node:crypto";
import { readFile, writeFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import type { EvalSuite, EvalVariant } from "../interfaces/suite.js";
import type { EvalResult, ExperimentRun } from "../interfaces/quality.js";
import { loadConfig } from "../config-loader.js";
import { loadEvalDataset } from "./dataset-io.js";
import { EvalRunner } from "./runner.js";
import { ExperimentStore, makeRunId } from "./experiment-store.js";
import { bootstrapPairedTest } from "./statistics.js";
import type { StatTestResult } from "./statistics.js";
import { downloadAndExtractTo } from "./archive.js";
import { ensurePluginsInstalled } from "./plugin-install.js";
import type { VirageDb } from "../core/virage-db.js";

type RawRecord = Record<string, unknown>;

interface ConfigFields {
  topK?: unknown;
  embedderPackage?: unknown;
  embedderModel?: unknown;
  vectorStorePackage?: unknown;
  searchHybrid?: unknown;
  searchHybridAlpha?: unknown;
  rerankerPackage?: unknown;
  pluginVersions?: unknown;
}

export interface SuiteVariantResult {
  name: string;
  evalResult: EvalResult;
  perQueryRrScores: number[];
  runId: string;
  /** Comparison against baseline (absent for the baseline variant itself) */
  comparison?: StatTestResult;
  /** Extracted config params for display in comparison output */
  configFields: ConfigFields;
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

function extractConfigFields(rawConfig: RawRecord, topK: number): ConfigFields {
  return {
    topK,
    embedderPackage: (rawConfig.embedder as RawRecord | undefined)?.package,
    embedderModel: (
      (rawConfig.embedder as RawRecord | undefined)?.config as
        | RawRecord
        | undefined
    )?.model,
    vectorStorePackage: (rawConfig.vectorStore as RawRecord | undefined)
      ?.package,
    searchHybrid: (rawConfig.search as RawRecord | undefined)?.hybrid ?? false,
    searchHybridAlpha: (rawConfig.search as RawRecord | undefined)?.hybridAlpha,
    rerankerPackage: (
      (rawConfig.search as RawRecord | undefined)?.reranker as
        | RawRecord
        | undefined
    )?.package,
    pluginVersions: rawConfig.pluginVersions,
  };
}

function printConfigParams(
  results: SuiteVariantResult[],
  log: (msg: string) => void,
): void {
  const fields: Array<keyof ConfigFields> = [
    "embedderPackage",
    "embedderModel",
    "vectorStorePackage",
    "topK",
    "searchHybrid",
    "searchHybridAlpha",
    "rerankerPackage",
  ];
  const labels: Record<string, string> = {
    embedderPackage: "embedder",
    embedderModel: "model",
    vectorStorePackage: "store",
    topK: "top-k",
    searchHybrid: "hybrid",
    searchHybridAlpha: "hybridAlpha",
    rerankerPackage: "reranker",
  };

  const sharedLines: string[] = [];
  const differsLines: string[] = [];

  for (const field of fields) {
    const vals = results.map((r) => String(r.configFields[field] ?? "none"));
    const unique = new Set(vals);
    const label = (labels[field] ?? field).padEnd(14);
    if (unique.size === 1) {
      if (vals[0] !== "undefined" && vals[0] !== "none") {
        sharedLines.push(`      ${label} ${vals[0]}`);
      }
    } else {
      const pairs = results
        .map((r) => `${r.name}=${String(r.configFields[field] ?? "none")}`)
        .join(", ");
      differsLines.push(`      ${label} ${pairs}`);
    }
  }

  log("  Config parameters:");
  if (sharedLines.length > 0) {
    log("    shared");
    for (const line of sharedLines) log(line);
  }
  if (differsLines.length > 0) {
    log("    differs");
    for (const line of differsLines) log(line);
  }
}

function buildRawConfigFromSuite(
  suite: EvalSuite,
  variant: EvalVariant,
): RawRecord {
  const db = suite.databases[variant.database];
  if (!db.embedder || !db.vectorStore) {
    throw new Error(
      `Database "${variant.database}" is missing "embedder" or "vectorStore" — required when variant.config is absent`,
    );
  }

  const effectiveChunkers = {
    ...(suite.chunkers ?? {}),
    ...(db.chunkers ?? {}),
  };
  const chunkerEntries = Object.entries(effectiveChunkers).map(
    ([filesetName, strategy]) => {
      const fileset = suite.filesets?.[filesetName];
      if (!fileset)
        throw new Error(
          `Unknown fileset "${filesetName}" referenced in chunkers`,
        );
      return {
        name: filesetName,
        patterns: fileset.include,
        ignorePatterns: fileset.exclude ?? [],
        strategy,
      };
    },
  );

  return {
    chunking: { exclude: suite.exclude ?? [], chunkers: chunkerEntries },
    embedder: db.embedder,
    vectorStore: db.vectorStore,
    ...(variant.search ? { search: variant.search } : {}),
    ...(db.pluginVersions ? { pluginVersions: db.pluginVersions } : {}),
  };
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

  const cacheDir = resolve(suiteDir, suite.cacheDir ?? ".virage/eval-cache");

  log("  Running variants...");

  const store = new ExperimentStore(db);
  const results: SuiteVariantResult[] = [];

  for (const variant of suite.variants) {
    if (variant.skip) {
      log(`    – ${variant.name}  (skipped)`);
      continue;
    }

    const spec = suite.databases[variant.database];
    if (!spec) {
      throw new Error(
        `Variant "${variant.name}" references unknown database "${variant.database}"`,
      );
    }

    let rawConfig: RawRecord;
    if (variant.config) {
      const variantConfigPath = resolve(suiteDir, variant.config);
      rawConfig = JSON.parse(
        await readFile(variantConfigPath, "utf-8"),
      ) as RawRecord;
    } else {
      rawConfig = buildRawConfigFromSuite(suite, variant);
    }

    // Collect plugin versions declared in the config (or captured in the DB spec)
    const pluginVersions =
      (rawConfig.pluginVersions as Record<string, string> | undefined) ?? {};
    const sortedPlugins = Object.entries(pluginVersions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}@${v}`);

    // Stable content-addressed dir: keyed by (database URL + plugin versions).
    // Variants sharing the same DB archive and plugin versions reuse one dir.
    const runKey = createHash("sha256")
      .update(spec.url + sortedPlugins.join(","))
      .digest("hex")
      .slice(0, 16);
    const evalRunDir = join(cacheDir, "runs", runKey);
    const lancedbDir = join(evalRunDir, "lancedb");
    const pluginDir = join(evalRunDir, "plugins");

    // Extract DB archive into evalRunDir/lancedb (idempotent)
    const { cached: dbCached } = await downloadAndExtractTo(
      spec.url,
      lancedbDir,
      spec.sha256,
      noCache,
    );

    // Install pinned plugins into evalRunDir/plugins (idempotent)
    if (sortedPlugins.length > 0) {
      await ensurePluginsInstalled(pluginVersions, pluginDir);
    }

    // Patch vectorStore.config.uri to point at the extracted DB
    const vectorStore = rawConfig.vectorStore as RawRecord | undefined;
    if (vectorStore) {
      vectorStore.config = {
        ...(vectorStore.config as RawRecord | undefined),
        uri: lancedbDir,
      };
    }

    const tmpDir = await mkdtemp(join(tmpdir(), "virage-suite-"));
    const tmpConfigPath = join(tmpDir, "config.json");
    await writeFile(tmpConfigPath, JSON.stringify(rawConfig));

    // Set VIRAGE_DIR so importPackage() picks up plugins from evalRunDir/plugins
    const prevVirageDir = process.env["VIRAGE_DIR"];
    if (sortedPlugins.length > 0) {
      process.env["VIRAGE_DIR"] = evalRunDir;
    }

    let cfg;
    try {
      cfg = await loadConfig(tmpConfigPath);
    } finally {
      if (sortedPlugins.length > 0) {
        if (prevVirageDir !== undefined) {
          process.env["VIRAGE_DIR"] = prevVirageDir;
        } else {
          delete process.env["VIRAGE_DIR"];
        }
      }
      await unlink(tmpConfigPath);
      await import("fs/promises")
        .then((m) => m.rm(tmpDir, { recursive: true, force: true }))
        .catch(() => {});
    }

    const configFields = extractConfigFields(rawConfig, topK);

    await cfg.vectorStore.initialize();
    try {
      const runner = new EvalRunner(
        cfg.vectorStore,
        cfg.embedder,
        dataset,
        topK,
        cfg.search,
      );
      const { evalResult, perQueryRrScores } = await runner.run();

      const run: ExperimentRun = {
        id: makeRunId(`suite-${variant.name}`),
        name: `suite:${variant.name}`,
        timestamp: new Date().toISOString(),
        config: {
          configFile: variant.config ?? `suite:${variant.database}`,
          database: variant.database,
          suiteDataset: suite.dataset,
          ...configFields,
        },
        evalResult,
        perQueryRrScores,
      };
      const runId = await store.save(run);

      const isBaseline = variant.name === suite.baseline;
      const mrrPct = (evalResult.mrr * 100).toFixed(1);
      const p5Pct = (evalResult.precisionAt5 * 100).toFixed(1);
      const hr5Pct = (evalResult.hitRateAt5 * 100).toFixed(1);
      const dbStatus = dbCached ? "cached" : "downloaded";
      log(
        `    ✓ ${variant.name.padEnd(24)} MRR=${mrrPct.padStart(5)}%  P@5=${p5Pct.padStart(5)}%  HR@5=${hr5Pct.padStart(5)}%  [${dbStatus}]${isBaseline ? "  [baseline]" : ""}`,
      );

      results.push({
        name: variant.name,
        evalResult,
        perQueryRrScores,
        runId,
        configFields,
      });
    } finally {
      await cfg.vectorStore.close?.();
    }
  }

  // ── Config params header ───────────────────────────────────────────────────

  log("");
  printConfigParams(results, log);

  // ── Bootstrap comparisons vs baseline ─────────────────────────────────────

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

  // ── CI gate ────────────────────────────────────────────────────────────────

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
