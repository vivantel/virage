import { loadConfig } from "../config-loader.js";
import type { VectorStore } from "../interfaces/index.js";

export interface StoreStatsOptions {
  config: string;
}

export interface StorePerfOptions {
  config: string;
  timeframeHours: number;
}

export async function runStoreStats(opts: StoreStatsOptions): Promise<void> {
  console.log("📂 Loading config...");
  const cfg = await loadConfig(opts.config);

  const store: VectorStore = cfg.vectorStore;

  if (!store.getIndexStats) {
    console.error(
      `❌ The configured vector store "${store.name}" does not support index stats.\n` +
        `   This command is currently supported by @vivantel/rag-store-postgres.`,
    );
    process.exit(1);
  }

  console.log("🔍 Fetching index stats...");
  await store.initialize();
  const stats = await store.getIndexStats();

  console.log("\n📊 Vector Index Stats");
  console.log("─".repeat(40));
  console.log(`  Total vectors     : ${stats.totalVectors.toLocaleString()}`);
  console.log(`  Index type        : ${stats.indexType}`);
  console.log(
    `  ANN recall@10     : ${stats.annRecallAt10 >= 0 ? (stats.annRecallAt10 * 100).toFixed(1) + "%" : "N/A"}`,
  );
  console.log(
    `  Index age         : ${stats.indexAgeHours >= 0 ? stats.indexAgeHours + " hours" : "unknown"}`,
  );
  console.log(
    `  Dead tuple frac.  : ${(stats.deadTupleFraction * 100).toFixed(1)}%`,
  );
  console.log("\n💡 Suggestions:");
  for (const s of stats.suggestions) {
    console.log(`   • ${s}`);
  }
  console.log("─".repeat(40));
}

export async function runStorePerf(opts: StorePerfOptions): Promise<void> {
  console.log("📂 Loading config...");
  const cfg = await loadConfig(opts.config);

  const store: VectorStore = cfg.vectorStore;

  if (!store.getQueryPerfReport) {
    console.error(
      `❌ The configured vector store "${store.name}" does not support query performance reports.\n` +
        `   This command is currently supported by @vivantel/rag-store-postgres.`,
    );
    process.exit(1);
  }

  console.log(`🔍 Fetching query perf for last ${opts.timeframeHours}h...`);
  await store.initialize();
  const report = await store.getQueryPerfReport(opts.timeframeHours);

  console.log("\n📊 Query Performance Report");
  console.log("─".repeat(40));
  console.log(`  Timeframe         : last ${report.timeframeHours}h`);
  console.log(
    `  p50 latency       : ${report.p50LatencyMs >= 0 ? report.p50LatencyMs + " ms" : "N/A"}`,
  );
  console.log(
    `  p95 latency       : ${report.p95LatencyMs >= 0 ? report.p95LatencyMs + " ms" : "N/A"}`,
  );
  console.log(
    `  p99 latency       : ${report.p99LatencyMs >= 0 ? report.p99LatencyMs + " ms" : "N/A"}`,
  );
  console.log(
    `  Slow queries      : ${report.slowQueryCount >= 0 ? report.slowQueryCount : "N/A"}`,
  );
  console.log("\n💡 Suggestions:");
  for (const s of report.suggestedIndexes) {
    console.log(`   • ${s}`);
  }
  console.log("─".repeat(40));
}
