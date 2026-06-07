import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { VirageDb } from "../core/virage-db.js";
import { TelemetryFlusher } from "./flusher.js";
import { TelemetrySession } from "./session.js";
import { DEFAULT_TELEMETRY_CONFIG, type TelemetryConfig } from "./types.js";

const FEEDBACK_CONFIG: TelemetryConfig = {
  ...DEFAULT_TELEMETRY_CONFIG,
  tiers: {
    ...DEFAULT_TELEMETRY_CONFIG.tiers,
    explicit_feedback: {
      enabled: true,
      sampling_rate: 1.0,
      always_on_anomaly: true,
      max_token_budget_percent: 3,
    },
  },
};

let dir: string;
let db: VirageDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tel-flusher-"));
  db = new VirageDb(join(dir, "virage.db"));
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function seedSession(
  sessionId: string,
  config: TelemetryConfig = DEFAULT_TELEMETRY_CONFIG,
) {
  return new TelemetrySession(db, config, sessionId, {
    nodeVersion: "v20.0.0",
    os: "linux",
    embeddingModel: "text-embedding-3-small",
    chunkingStrategy: "semantic",
    storeType: "sqlite",
  });
}

describe("TelemetryFlusher.buildSessionSummaryPayload", () => {
  it("returns null for an unknown session", () => {
    const flusher = new TelemetryFlusher(db, DEFAULT_TELEMETRY_CONFIG);
    expect(flusher.buildSessionSummaryPayload("no-such-id")).toBeNull();
  });

  it("returns a payload with session metadata", () => {
    seedSession("sess-a");
    const flusher = new TelemetryFlusher(db, DEFAULT_TELEMETRY_CONFIG);
    const payload = flusher.buildSessionSummaryPayload("sess-a");
    expect(payload).not.toBeNull();
    expect(payload!.session.id).toBe("sess-a");
    expect(payload!.session.embedding_model).toBe("text-embedding-3-small");
    expect(payload!.session.node_version).toBe("v20.0.0");
  });

  it("builds result_count histogram correctly", () => {
    const session = seedSession("sess-b");
    session.recordSearch("s1", 0, [1, 0]);
    session.recordSearch("s2", 5, [0, 1]);
    session.recordSearch("s3", 5, [1, 1]);
    session.recordSearch("s4", 15, [0.5, 0.5]);

    const flusher = new TelemetryFlusher(db, DEFAULT_TELEMETRY_CONFIG);
    const payload = flusher.buildSessionSummaryPayload("sess-b")!;
    expect(payload.searches.total).toBe(4);
    expect(payload.searches.empty_count).toBe(1);
    expect(payload.searches.result_count_histogram["0"]).toBe(1);
    expect(payload.searches.result_count_histogram["4-10"]).toBe(2);
    expect(payload.searches.result_count_histogram["11-20"]).toBe(1);
  });

  it("computes latency percentiles correctly", () => {
    const session = seedSession("sess-c");
    // Insert 10 known durations for "embed" phase
    for (let i = 1; i <= 10; i++) {
      session.recordLatency("embed", i * 10); // 10,20,...,100
    }

    const flusher = new TelemetryFlusher(db, DEFAULT_TELEMETRY_CONFIG);
    const payload = flusher.buildSessionSummaryPayload("sess-c")!;
    const embed = payload.latency.by_phase["embed"];
    expect(embed.count).toBe(10);
    // sorted: [10,20,30,40,50,60,70,80,90,100]
    // p50 = index floor(0.5*10)=5 → value 60
    expect(embed.p50).toBe(60);
    // p95 = index floor(0.95*10)=9 → value 100
    expect(embed.p95).toBe(100);
    expect(embed.p99).toBe(100);
  });

  it("summarises errors by type", () => {
    const session = seedSession("sess-d");
    session.recordError("rate_limit", 1, true);
    session.recordError("rate_limit", 3, false);
    session.recordError("embedding_timeout", 0, true);

    const flusher = new TelemetryFlusher(db, DEFAULT_TELEMETRY_CONFIG);
    const payload = flusher.buildSessionSummaryPayload("sess-d")!;
    expect(payload.errors.by_type["rate_limit"].count).toBe(2);
    expect(payload.errors.by_type["rate_limit"].recovered_count).toBe(1);
    expect(payload.errors.by_type["embedding_timeout"].count).toBe(1);
    expect(payload.errors.by_type["embedding_timeout"].recovered_count).toBe(1);
  });

  it("summarises feedback averages and distribution", () => {
    const session = seedSession("sess-e", FEEDBACK_CONFIG);
    session.recordFeedback("s1", {
      wasUseful: true,
      contextRelevance: 0.8,
      missingCategory: "missing_error_handling",
    });
    session.recordFeedback("s2", {
      wasUseful: false,
      contextRelevance: 0.4,
      missingCategory: "missing_error_handling",
    });

    const flusher = new TelemetryFlusher(db, FEEDBACK_CONFIG);
    const payload = flusher.buildSessionSummaryPayload("sess-e")!;
    expect(payload.feedback.count).toBe(2);
    expect(payload.feedback.avg_context_relevance).toBeCloseTo(0.6, 5);
    expect(payload.feedback.missing_category_distribution[
      "missing_error_handling"
    ]).toBe(2);
  });

  it("returns null average fields when no data", () => {
    seedSession("sess-f");
    const flusher = new TelemetryFlusher(db, DEFAULT_TELEMETRY_CONFIG);
    const payload = flusher.buildSessionSummaryPayload("sess-f")!;
    expect(payload.feedback.avg_context_relevance).toBeNull();
    expect(payload.cache.avg_file_hit_rate).toBeNull();
  });
});

describe("TelemetryFlusher.flush", () => {
  it("returns false when telemetry is disabled", async () => {
    const config: TelemetryConfig = {
      ...DEFAULT_TELEMETRY_CONFIG,
      enabled: false,
      endpoint: "https://example.com/telemetry",
    };
    const flusher = new TelemetryFlusher(db, config);
    expect(await flusher.flush("any-id")).toBe(false);
  });

  it("returns false when endpoint is not configured", async () => {
    const config: TelemetryConfig = {
      ...DEFAULT_TELEMETRY_CONFIG,
      endpoint: undefined,
    };
    const flusher = new TelemetryFlusher(db, config);
    expect(await flusher.flush("any-id")).toBe(false);
  });

  it("POSTs payload to endpoint and marks session flushed on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const config: TelemetryConfig = {
      ...DEFAULT_TELEMETRY_CONFIG,
      endpoint: "https://example.com/telemetry",
      api_key: "test-key",
    };

    seedSession("sess-g");
    const flusher = new TelemetryFlusher(db, config);
    const result = await flusher.flush("sess-g");

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/telemetry");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-key",
    );
    const body = JSON.parse(init.body as string) as { session: { id: string } };
    expect(body.session.id).toBe("sess-g");

    // session should be marked flushed
    expect(db.getTelemetrySession("sess-g")?.flushed).toBe(1);
  });

  it("returns false and leaves session unflushed on HTTP error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    const config: TelemetryConfig = {
      ...DEFAULT_TELEMETRY_CONFIG,
      endpoint: "https://example.com/telemetry",
    };

    seedSession("sess-h");
    const flusher = new TelemetryFlusher(db, config);
    const result = await flusher.flush("sess-h");

    expect(result).toBe(false);
    expect(db.getTelemetrySession("sess-h")?.flushed).toBe(0);
  });

  it("returns false gracefully on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const config: TelemetryConfig = {
      ...DEFAULT_TELEMETRY_CONFIG,
      endpoint: "https://example.com/telemetry",
    };

    seedSession("sess-i");
    const flusher = new TelemetryFlusher(db, config);
    await expect(flusher.flush("sess-i")).resolves.toBe(false);
  });
});
