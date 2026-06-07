import { randomUUID } from "crypto";
import type { VirageDb } from "../core/virage-db.js";
import type { TelemetryConfig, SessionMetadata } from "./types.js";
import { TelemetrySession } from "./session.js";

export class TelemetryManager {
  private activeSession: TelemetrySession | null = null;

  constructor(
    private readonly db: VirageDb,
    private readonly config: TelemetryConfig,
  ) {}

  startSession(metadata: SessionMetadata): TelemetrySession {
    const session = new TelemetrySession(
      this.db,
      this.config,
      randomUUID(),
      metadata,
    );
    this.activeSession = session;
    return session;
  }

  getActiveSession(): TelemetrySession | null {
    return this.activeSession;
  }

  printFirstRunDisclosure(): void {
    if (!this.config.enabled) return;
    if (this.db.hasTelemetrySessions()) return;

    process.stderr.write(
      "\nℹ️  Virage telemetry is enabled (Tier 1 only).\n" +
        "   Collected: search counts, result distribution, latency, error rates.\n" +
        "   No query content or file paths are transmitted.\n" +
        "   To opt out: virage telemetry off\n\n",
    );

    if (this.config.tiers.explicit_feedback.enabled) {
      process.stderr.write(
        "ℹ️  Tier 2 (rag_feedback) is also enabled.\n" +
          `   Claude will call rag_feedback on ~${Math.round(this.config.tiers.explicit_feedback.sampling_rate * 100)}% of searches.\n` +
          `   This uses up to ${this.config.tiers.explicit_feedback.max_token_budget_percent}% of your session token budget.\n` +
          "   To disable Tier 2 only: virage telemetry off --tiers explicit_feedback\n\n",
      );
    }
  }
}
