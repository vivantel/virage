import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";

interface StageStats {
  durationMs: number;
  [key: string]: unknown;
}

interface TelemetryData {
  runAt: string;
  durationMs: number;
  stages: {
    gitTracking?: StageStats & {
      filesScanned: number;
      toProcess: number;
      toDelete: number;
    };
    chunking?: StageStats & {
      filesProcessed: number;
      chunksGenerated: number;
      errors: number;
    };
    embedding?: StageStats & {
      chunksEmbedded: number;
      chunksSkipped: number;
      /** Per-embed call latency in ms (for p50/p95/p99 reporting). */
      latencySamples?: number[];
      /** Number of rate-limit events (retries due to 429 responses). */
      rateLimitEvents?: number;
    };
    upload?: StageStats & {
      uploaded: number;
      deleted: number;
    };
  };
}

export class TelemetryCollector {
  private startedAt = 0;
  private data: TelemetryData = {
    runAt: new Date().toISOString(),
    durationMs: 0,
    stages: {},
  };

  start(): void {
    this.startedAt = Date.now();
    this.data.runAt = new Date().toISOString();
  }

  recordGitTracking(stats: {
    filesScanned: number;
    toProcess: number;
    toDelete: number;
    durationMs: number;
  }): void {
    this.data.stages.gitTracking = stats;
  }

  recordChunking(stats: {
    filesProcessed: number;
    chunksGenerated: number;
    errors: number;
    durationMs: number;
  }): void {
    this.data.stages.chunking = stats;
  }

  recordEmbedding(stats: {
    chunksEmbedded: number;
    chunksSkipped: number;
    durationMs: number;
    latencySamples?: number[];
    rateLimitEvents?: number;
  }): void {
    this.data.stages.embedding = stats;
  }

  recordUpload(stats: {
    uploaded: number;
    deleted: number;
    durationMs: number;
  }): void {
    this.data.stages.upload = stats;
  }

  finish(): void {
    this.data.durationMs = Date.now() - this.startedAt;
  }

  getData(): TelemetryData {
    return this.data;
  }

  printSummary(logger?: Logger): void {
    const log = (logger ?? new NullLogger()).withTag("telemetry");
    log.info(`📊 Telemetry summary (${this.data.durationMs}ms total):`);
    for (const [stage, stats] of Object.entries(this.data.stages)) {
      if (!stats) continue;
      const { durationMs, ...rest } = stats;
      const details = Object.entries(rest)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      log.info(`   ${stage}: ${details} (${durationMs}ms)`);
    }
  }

  async save(outputPath: string, logger?: Logger): Promise<void> {
    const log = (logger ?? new NullLogger()).withTag("telemetry");
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(this.data, null, 2));
    log.info(`📈 Telemetry saved to ${outputPath}`);
  }
}
