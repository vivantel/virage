import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { VirageDb } from "../core/virage-db.js";
import { TelemetrySession } from "./session.js";
import { DEFAULT_TELEMETRY_CONFIG, type TelemetryConfig } from "./types.js";

function makeConfig(overrides: Partial<TelemetryConfig> = {}): TelemetryConfig {
  return {
    ...DEFAULT_TELEMETRY_CONFIG,
    ...overrides,
    tiers: {
      ...DEFAULT_TELEMETRY_CONFIG.tiers,
      ...(overrides.tiers ?? {}),
      explicit_feedback: {
        ...DEFAULT_TELEMETRY_CONFIG.tiers.explicit_feedback,
        ...(overrides.tiers?.explicit_feedback ?? {}),
      },
    },
  };
}

let dir: string;
let db: VirageDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tel-session-"));
  db = new VirageDb(join(dir, "virage.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("TelemetrySession — basic recording", () => {
  it("inserts a session row on construction", () => {
    const session = new TelemetrySession(
      db,
      makeConfig(),
      "sess-1",
      { nodeVersion: "v20.0.0", os: "linux" },
    );
    const row = db.getTelemetrySession("sess-1");
    expect(row).not.toBeNull();
    expect(row?.id).toBe("sess-1");
    expect(row?.total_searches).toBe(0);
    expect(session.id).toBe("sess-1");
  });

  it("does not insert a session row when disabled", () => {
    new TelemetrySession(
      db,
      makeConfig({ enabled: false }),
      "sess-disabled",
      { nodeVersion: "v20.0.0", os: "linux" },
    );
    const row = db.getTelemetrySession("sess-disabled");
    expect(row).toBeNull();
  });

  it("recordSearch inserts a search row and increments total_searches", () => {
    const session = new TelemetrySession(db, makeConfig(), "sess-2", {
      nodeVersion: "v20.0.0",
      os: "linux",
    });
    session.recordSearch("search-1", 5, [0.1, 0.2, 0.3]);
    const searches = db.getSearchesForSession("sess-2");
    expect(searches).toHaveLength(1);
    expect(searches[0].result_count).toBe(5);
    expect(searches[0].result_count_bucket).toBe("4-10");
    expect(searches[0].empty).toBe(0);
    expect(db.getTelemetrySession("sess-2")?.total_searches).toBe(1);
  });

  it("stores query_hash only for empty results", () => {
    const session = new TelemetrySession(db, makeConfig(), "sess-3", {
      nodeVersion: "v20.0.0",
      os: "linux",
    });
    session.recordSearch("s1", 0, [0.1, 0.2]);
    session.recordSearch("s2", 3, [0.3, 0.4]);
    const searches = db.getSearchesForSession("sess-3");
    expect(searches.find((s) => s.id === "s1")?.query_hash).toBeTruthy();
    expect(searches.find((s) => s.id === "s2")?.query_hash).toBeNull();
  });

  it("recordLatency inserts a latency row", () => {
    const session = new TelemetrySession(db, makeConfig(), "sess-4", {
      nodeVersion: "v20.0.0",
      os: "linux",
    });
    session.recordLatency("embed", 42);
    session.recordLatency("search", 17);
    const rows = db.getLatencyForSession("sess-4");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.phase)).toEqual(["embed", "search"]);
  });

  it("recordError inserts an error row", () => {
    const session = new TelemetrySession(db, makeConfig(), "sess-5", {
      nodeVersion: "v20.0.0",
      os: "linux",
    });
    session.recordError("rate_limit", 2, true);
    const rows = db.getErrorsForSession("sess-5");
    expect(rows).toHaveLength(1);
    expect(rows[0].error_type).toBe("rate_limit");
    expect(rows[0].retry_count).toBe(2);
    expect(rows[0].recovered).toBe(1);
  });

  it("end() sets ended_at", () => {
    const session = new TelemetrySession(db, makeConfig(), "sess-6", {
      nodeVersion: "v20.0.0",
      os: "linux",
    });
    expect(db.getTelemetrySession("sess-6")?.ended_at).toBeFalsy();
    session.end();
    expect(db.getTelemetrySession("sess-6")?.ended_at).toBeTruthy();
  });
});

describe("TelemetrySession — redundancy detection", () => {
  it("detects a near-duplicate query as redundant", () => {
    const session = new TelemetrySession(db, makeConfig(), "sess-r1", {
      nodeVersion: "v20.0.0",
      os: "linux",
    });
    const embedding = [1, 0, 0];
    const nearDupe = [0.99, 0.01, 0]; // cosine > 0.8

    session.recordSearch("s1", 3, embedding);
    session.recordSearch("s2", 3, nearDupe);

    const searches = db.getSearchesForSession("sess-r1");
    expect(searches[0].redundancy_detected).toBe(0);
    expect(searches[1].redundancy_detected).toBe(1);
  });

  it("does not flag a clearly different query as redundant", () => {
    const session = new TelemetrySession(db, makeConfig(), "sess-r2", {
      nodeVersion: "v20.0.0",
      os: "linux",
    });
    session.recordSearch("s1", 3, [1, 0, 0]);
    session.recordSearch("s2", 3, [0, 1, 0]); // orthogonal
    const searches = db.getSearchesForSession("sess-r2");
    expect(searches[1].redundancy_detected).toBe(0);
  });
});

describe("TelemetrySession — feedback sampling", () => {
  it("shouldSampleFeedback returns false when disabled", () => {
    const session = new TelemetrySession(
      db,
      makeConfig({ tiers: { ...DEFAULT_TELEMETRY_CONFIG.tiers, explicit_feedback: { ...DEFAULT_TELEMETRY_CONFIG.tiers.explicit_feedback, enabled: false } } }),
      "sess-f1",
      { nodeVersion: "v20.0.0", os: "linux" },
    );
    expect(session.shouldSampleFeedback(5)).toBe(false);
  });

  it("shouldSampleFeedback always returns true for 0-result searches when always_on_anomaly", () => {
    const session = new TelemetrySession(
      db,
      makeConfig({
        tiers: {
          ...DEFAULT_TELEMETRY_CONFIG.tiers,
          explicit_feedback: {
            enabled: true,
            sampling_rate: 0,
            always_on_anomaly: true,
            max_token_budget_percent: 3,
          },
        },
      }),
      "sess-f2",
      { nodeVersion: "v20.0.0", os: "linux" },
    );
    expect(session.shouldSampleFeedback(0)).toBe(true);
    expect(session.shouldSampleFeedback(11)).toBe(true);
    expect(session.shouldSampleFeedback(5)).toBe(false); // sampling_rate=0
  });

  it("recordFeedback inserts a feedback row", () => {
    const session = new TelemetrySession(
      db,
      makeConfig({
        tiers: {
          ...DEFAULT_TELEMETRY_CONFIG.tiers,
          explicit_feedback: {
            enabled: true,
            sampling_rate: 1.0,
            always_on_anomaly: true,
            max_token_budget_percent: 3,
          },
        },
      }),
      "sess-f3",
      { nodeVersion: "v20.0.0", os: "linux" },
    );
    session.recordFeedback("search-x", {
      wasUseful: true,
      contextRelevance: 0.9,
      missingCategory: "missing_error_handling",
    });
    const rows = db.getFeedbackForSession("sess-f3");
    expect(rows).toHaveLength(1);
    expect(rows[0].was_useful).toBe(1);
    expect(rows[0].context_relevance).toBe(0.9);
    expect(rows[0].missing_category).toBe("missing_error_handling");
  });

  it("normalizes unknown missing_category to 'other'", () => {
    const session = new TelemetrySession(
      db,
      makeConfig({
        tiers: {
          ...DEFAULT_TELEMETRY_CONFIG.tiers,
          explicit_feedback: {
            enabled: true,
            sampling_rate: 1.0,
            always_on_anomaly: true,
            max_token_budget_percent: 3,
          },
        },
      }),
      "sess-f4",
      { nodeVersion: "v20.0.0", os: "linux" },
    );
    session.recordFeedback("search-y", {
      wasUseful: false,
      missingCategory: "some_unknown_value",
    });
    const rows = db.getFeedbackForSession("sess-f4");
    expect(rows[0].missing_category).toBe("other");
  });
});
