import { loadConfig } from "@vivantel/virage-core";
import type { VectorStore } from "@vivantel/virage-core";
import { createOut } from "../output.js";
import { withSpinner } from "../spinner.js";

export interface StoreStatsOptions {
  config: string;
  verbosity: number;
}

export interface StorePerfOptions {
  config: string;
  timeframeHours: number;
  verbosity: number;
}

export async function runStoreStats(opts: StoreStatsOptions): Promise<void> {
  const out = createOut(opts.verbosity);
  const cfg = await withSpinner("Loading config", () =>
    loadConfig(opts.config),
  );

  const store: VectorStore = cfg.vectorStore;

  if (!store.getIndexStats) {
    out.error(
      `The configured vector store "${store.name}" does not support index stats.`,
    );
    process.exit(1);
  }

  const stats = await withSpinner("Fetching index stats", async () => {
    await store.initialize();
    return store.getIndexStats!();
  });

  out.section("📊 Vector Index Stats");
  out.info(`  Total vectors     : ${stats.totalVectors.toLocaleString()}`);
  out.info(`  Index type        : ${stats.indexType}`);
  out.info(
    `  ANN recall@10     : ${stats.annRecallAt10 >= 0 ? (stats.annRecallAt10 * 100).toFixed(1) + "%" : "N/A"}`,
  );
  out.info(
    `  Index age         : ${stats.indexAgeHours >= 0 ? stats.indexAgeHours + " hours" : "unknown"}`,
  );
  out.info(
    `  Dead tuple frac.  : ${(stats.deadTupleFraction * 100).toFixed(1)}%`,
  );
  out.divider();
  out.info("Suggestions:");
  for (const s of stats.suggestions) {
    out.info(`   • ${s}`);
  }
  out.divider();
}

export async function runStorePerf(opts: StorePerfOptions): Promise<void> {
  const out = createOut(opts.verbosity);
  const cfg = await withSpinner("Loading config", () =>
    loadConfig(opts.config),
  );

  const store: VectorStore = cfg.vectorStore;

  if (!store.getQueryPerfReport) {
    out.error(
      `The configured vector store "${store.name}" does not support query performance reports.`,
    );
    process.exit(1);
  }

  const report = await withSpinner(
    `Fetching query perf for last ${opts.timeframeHours}h`,
    async () => {
      await store.initialize();
      return store.getQueryPerfReport!(opts.timeframeHours);
    },
  );

  out.section("📊 Query Performance Report");
  out.info(`  Timeframe         : last ${report.timeframeHours}h`);
  out.info(
    `  p50 latency       : ${report.p50LatencyMs >= 0 ? report.p50LatencyMs + " ms" : "N/A"}`,
  );
  out.info(
    `  p95 latency       : ${report.p95LatencyMs >= 0 ? report.p95LatencyMs + " ms" : "N/A"}`,
  );
  out.info(
    `  p99 latency       : ${report.p99LatencyMs >= 0 ? report.p99LatencyMs + " ms" : "N/A"}`,
  );
  out.info(
    `  Slow queries      : ${report.slowQueryCount >= 0 ? report.slowQueryCount : "N/A"}`,
  );
  out.divider();
}
