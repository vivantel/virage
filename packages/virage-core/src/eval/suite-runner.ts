import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, unlink, mkdtemp, rm } from "fs/promises";
import { existsSync } from "fs";
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
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";

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
  /** Logger for verbose/debug/trace output controlled by -v flags */
  logger?: Logger;
  /** Numeric verbosity level (0 = default, 1 = -v, 2 = -vv, …) */
  verbosity?: number;
  /** Override the default process.stdout.write log sink */
  onLog?: (msg: string) => void;
  /** Called just before each variant begins download + evaluation */
  onVariantBegin?: (name: string) => void;
  /** Called immediately after a variant's evaluation completes */
  onVariantComplete?: (name: string) => void;
}

function pluginRefLabel(ref: RawRecord | undefined): string | undefined {
  if (!ref) return undefined;
  // v2 builtin key takes precedence; fall back to package name
  return (
    (ref.builtin as string | undefined) ?? (ref.package as string | undefined)
  );
}

function extractConfigFields(rawConfig: RawRecord, topK: number): ConfigFields {
  const providers = rawConfig.providers as RawRecord | undefined;
  return {
    topK,
    embedderPackage: pluginRefLabel(
      providers?.embedder as RawRecord | undefined,
    ),
    embedderModel: (
      (providers?.embedder as RawRecord | undefined)?.options as
        RawRecord | undefined
    )?.model,
    vectorStorePackage: pluginRefLabel(
      providers?.vectorStore as RawRecord | undefined,
    ),
    searchHybrid: (rawConfig.search as RawRecord | undefined)?.hybrid ?? false,
    searchHybridAlpha: (rawConfig.search as RawRecord | undefined)?.hybridAlpha,
    rerankerPackage: pluginRefLabel(
      providers?.reranker as RawRecord | undefined,
    ),
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
    ([filesetName, packageName]) => {
      const fileset = suite.filesets?.[filesetName];
      if (!fileset)
        throw new Error(
          `Unknown fileset "${filesetName}" referenced in chunkers`,
        );
      const entry: Record<string, unknown> = { package: packageName };
      if (fileset.include?.length) entry.include = fileset.include;
      if (fileset.exclude?.length) entry.ignore = fileset.exclude;
      return entry;
    },
  );

  return {
    providers: {
      embedder: db.embedder,
      vectorStore: db.vectorStore,
    },
    fileSets: chunkerEntries.map((entry, i) => ({
      name: Object.keys(effectiveChunkers)[i] ?? `fileset-${i}`,
      include: entry.include as string[] | undefined,
      ignore: entry.ignore as string[] | undefined,
      chunkers: [{ package: entry.package as string }],
    })),
    ignore: suite.exclude,
    ...(variant.search ? { search: variant.search } : {}),
    ...(db.pluginVersions ? { pluginVersions: db.pluginVersions } : {}),
  };
}

interface ProgressFile {
  fingerprint: string;
  completedAt: Record<string, string>;
  results: SuiteVariantResult[];
}

export async function runSuite(
  suite: EvalSuite,
  suiteDir: string,
  db: VirageDb,
  opts: SuiteRunOptions = {},
): Promise<SuiteResult> {
  const { silent = false, noCache = false, verbosity = 0 } = opts;
  const logger = opts.logger ?? new NullLogger();
  const log = silent
    ? () => {}
    : opts.onLog
      ? (msg: string) => opts.onLog!(msg)
      : (msg: string) => process.stdout.write(msg + "\n");

  const topK = suite.topK ?? 10;
  const datasetPath = resolve(suiteDir, suite.dataset);
  const dataset = await loadEvalDataset(datasetPath);

  log(
    `  dataset: ${suite.dataset}  queries: ${dataset.queries.length}  top-k: ${topK}`,
  );
  log("");

  const cacheDir = resolve(suiteDir, suite.cacheDir ?? ".virage/eval-cache");

  // ── Idempotency: fingerprint suite config + dataset, resume if possible ──────
  const datasetContent = await readFile(datasetPath, "utf-8");
  const suiteFingerprint = createHash("sha256")
    .update(JSON.stringify(suite))
    .update(datasetContent)
    .digest("hex")
    .slice(0, 16);
  const progressPath = join(cacheDir, `progress-${suiteFingerprint}.json`);

  let completedAt: Record<string, string> = {};
  const results: SuiteVariantResult[] = [];

  if (!noCache && existsSync(progressPath)) {
    try {
      const saved = JSON.parse(
        await readFile(progressPath, "utf-8"),
      ) as ProgressFile;
      if (saved.fingerprint === suiteFingerprint) {
        completedAt = saved.completedAt;
        results.push(...saved.results);
        if (Object.keys(completedAt).length > 0) {
          log(
            `  Resuming — ${Object.keys(completedAt).length} variant(s) already complete`,
          );
        }
      }
    } catch {
      // Corrupt progress file — start fresh
    }
  }

  log("  Running variants...");

  const store = new ExperimentStore(db);

  for (const variant of suite.variants) {
    if (variant.skip) {
      log(`    – ${variant.name}  (skipped)`);
      continue;
    }

    if (completedAt[variant.name]) {
      const existing = results.find((r) => r.name === variant.name);
      if (existing) {
        const mrrPct = (existing.evalResult.mrr * 100).toFixed(1);
        const p5Pct = (existing.evalResult.precisionAt5 * 100).toFixed(1);
        const hr5Pct = (existing.evalResult.hitRateAt5 * 100).toFixed(1);
        log(
          `    ✓ ${variant.name.padEnd(24)} MRR=${mrrPct.padStart(5)}%  P@5=${p5Pct.padStart(5)}%  HR@5=${hr5Pct.padStart(5)}%  [cached]`,
        );
        continue;
      }
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

    opts.onVariantBegin?.(variant.name);

    // Extract DB archive into evalRunDir/lancedb (idempotent)
    const { cached: dbCached } = await downloadAndExtractTo(
      spec.url,
      lancedbDir,
      spec.sha256,
      noCache,
      logger,
    );

    // Install pinned plugins into evalRunDir/plugins (idempotent)
    if (sortedPlugins.length > 0) {
      logger.verbose(
        `Installing ${sortedPlugins.length} plugin(s): ${sortedPlugins.join(", ")}`,
      );
      await ensurePluginsInstalled(pluginVersions, pluginDir, verbosity >= 4);
      logger.verbose(`Plugins ready`);
    }

    // Patch providers.vectorStore.options.uri to point at the extracted DB
    const providers = rawConfig.providers as RawRecord | undefined;
    const vectorStore = providers?.vectorStore as RawRecord | undefined;
    if (vectorStore) {
      vectorStore.options = {
        ...(vectorStore.options as RawRecord | undefined),
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

    logger.debug(
      `Variant "${variant.name}": hybrid=${String(configFields.searchHybrid ?? false)}, ` +
        `alpha=${String(configFields.searchHybridAlpha ?? "none")}, ` +
        `reranker=${String(configFields.rerankerPackage ?? "none")}`,
    );

    await cfg.vectorStore.initialize();
    try {
      const runner = new EvalRunner(
        cfg.vectorStore,
        cfg.embedder,
        dataset,
        topK,
        cfg.search,
      );
      const onProgress = (done: number, total: number, query: string) =>
        logger.trace(`[${done}/${total}] "${query}"`);
      const { evalResult, perQueryRrScores } = await runner.run(onProgress);

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

      opts.onVariantComplete?.(variant.name);

      // Persist progress so an interrupted run can resume
      completedAt[variant.name] = new Date().toISOString();
      const progress: ProgressFile = {
        fingerprint: suiteFingerprint,
        completedAt,
        results,
      };
      await mkdir(cacheDir, { recursive: true })
        .then(() => writeFile(progressPath, JSON.stringify(progress), "utf-8"))
        .catch(() => {});
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

  // All variants complete — clean up progress file
  if (existsSync(progressPath)) {
    await rm(progressPath, { force: true }).catch(() => {});
  }

  return { variants: results, baseline: baselineResult, ciPassed };
}
