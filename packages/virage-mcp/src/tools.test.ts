import { describe, it, expect, vi } from "vitest";
import { handleRagFeedback, type McpContext, type RagFeedbackArgs } from "./tools.js";
import type { TelemetrySession } from "@vivantel/virage-core";
import { normalizeMissingCategory } from "@vivantel/virage-core";

function makeMockSession(): TelemetrySession {
  return {
    id: "mock-session",
    recordSearch: vi.fn(),
    recordLatency: vi.fn(),
    recordError: vi.fn(),
    recordFeedback: vi.fn(),
    recordCacheStats: vi.fn(),
    shouldSampleFeedback: vi.fn().mockReturnValue(false),
    end: vi.fn(),
  } as unknown as TelemetrySession;
}

function makeCtx(overrides?: Partial<McpContext>): McpContext {
  return {
    db: {} as never,
    embedder: {} as never,
    vectorStore: {} as never,
    ...overrides,
  };
}

describe("handleRagFeedback", () => {
  it("does nothing when session is absent", () => {
    const ctx = makeCtx();
    expect(() =>
      handleRagFeedback({ was_useful: true }, ctx),
    ).not.toThrow();
  });

  it("does nothing when no search_id is available", () => {
    const session = makeMockSession();
    const ctx = makeCtx({ session });
    handleRagFeedback({ was_useful: true }, ctx);
    expect(session.recordFeedback).not.toHaveBeenCalled();
  });

  it("records feedback using explicit search_query_id", () => {
    const session = makeMockSession();
    const ctx = makeCtx({ session });
    const args: RagFeedbackArgs = {
      search_query_id: "explicit-id",
      was_useful: true,
      metrics: {
        context_relevance: 0.9,
        missing_category: "missing_error_handling",
      },
    };
    handleRagFeedback(args, ctx);
    expect(session.recordFeedback).toHaveBeenCalledOnce();
    const [searchId, payload] = (
      session.recordFeedback as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, { wasUseful: boolean; contextRelevance: number; missingCategory: string }];
    expect(searchId).toBe("explicit-id");
    expect(payload.wasUseful).toBe(true);
    expect(payload.contextRelevance).toBe(0.9);
    expect(payload.missingCategory).toBe("missing_error_handling");
  });

  it("falls back to ctx.lastSearchId when search_query_id is omitted", () => {
    const session = makeMockSession();
    const ctx = makeCtx({ session, lastSearchId: "last-search" });
    handleRagFeedback({ was_useful: false }, ctx);
    const [searchId] = (
      session.recordFeedback as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string];
    expect(searchId).toBe("last-search");
  });

  it("normalizes unknown missing_category to 'other' before recording", () => {
    const session = makeMockSession();
    const ctx = makeCtx({ session, lastSearchId: "s1" });
    handleRagFeedback(
      {
        was_useful: false,
        metrics: { missing_category: "completely_made_up_value" },
      },
      ctx,
    );
    const [, payload] = (
      session.recordFeedback as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, { missingCategory: string }];
    expect(payload.missingCategory).toBe("other");
  });

  it("passes optional metric fields through", () => {
    const session = makeMockSession();
    const ctx = makeCtx({ session, lastSearchId: "s2" });
    handleRagFeedback(
      {
        was_useful: true,
        metrics: {
          context_completeness: 0.7,
          noise_ratio: 0.1,
        },
      },
      ctx,
    );
    const [, payload] = (
      session.recordFeedback as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, { contextCompleteness: number; noiseRatio: number }];
    expect(payload.contextCompleteness).toBe(0.7);
    expect(payload.noiseRatio).toBe(0.1);
  });
});

describe("normalizeMissingCategory", () => {
  it("passes through known categories unchanged", () => {
    const known = [
      "missing_error_handling",
      "missing_config_example",
      "missing_api_reference",
      "missing_type_signature",
      "missing_test_coverage",
      "other",
    ] as const;
    for (const cat of known) {
      expect(normalizeMissingCategory(cat)).toBe(cat);
    }
  });

  it("maps unknown values to 'other'", () => {
    expect(normalizeMissingCategory("random_unknown")).toBe("other");
    expect(normalizeMissingCategory("MISSING_ERROR_HANDLING")).toBe("other"); // case-sensitive
  });

  it("returns undefined for undefined input", () => {
    expect(normalizeMissingCategory(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    // empty string is falsy → undefined
    expect(normalizeMissingCategory("")).toBeUndefined();
  });
});
