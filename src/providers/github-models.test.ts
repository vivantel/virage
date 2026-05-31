import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSleep } = vi.hoisted(() => ({
  mockSleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../core/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../core/utils.js")>();
  return { ...actual, sleep: mockSleep };
});

import { GitHubModelsEmbedder } from "./github-models.js";

const FAKE_EMBEDDING = [0.1, 0.2, 0.3];

function makeSuccessResponse(
  embeddings: number[][],
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ data: embeddings.map((embedding) => ({ embedding })) }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", ...headers },
    },
  );
}

function makeErrorResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("GitHubModelsEmbedder", () => {
  const embedder = new GitHubModelsEmbedder({ token: "test-token" });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockSleep.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("embed()", () => {
    it("returns the first embedding vector from the response", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeSuccessResponse([[0.1, 0.2, 0.3]]),
      );
      const result = await embedder.embed("hello");
      expect(result).toEqual(FAKE_EMBEDDING);
    });

    it("sends the text as a string (not array) in the request body", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeSuccessResponse([[0.1, 0.2, 0.3]]),
      );
      await embedder.embed("single text");
      const body = JSON.parse(
        (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.input).toEqual(["single text"]);
    });
  });

  describe("embedBatch()", () => {
    it("returns one embedding vector per input text", async () => {
      const embeddings = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      vi.mocked(fetch).mockResolvedValue(makeSuccessResponse(embeddings));
      const result = await embedder.embedBatch(["a", "b", "c"]);
      expect(result).toEqual(embeddings);
    });
  });

  describe("rate limit headers", () => {
    it("logs remaining quota when x-ratelimit-remaining is present", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.mocked(fetch).mockResolvedValue(
        makeSuccessResponse([[0.1, 0.2, 0.3]], {
          "x-ratelimit-remaining": "42",
        }),
      );
      await embedder.embed("text");
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("42"));
      consoleSpy.mockRestore();
    });

    it("sleeps until reset when x-ratelimit-remaining is 0", async () => {
      const resetAt = Math.floor(Date.now() / 1000) + 10; // 10s from now
      vi.mocked(fetch).mockResolvedValue(
        makeSuccessResponse([[0.1, 0.2, 0.3]], {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(resetAt),
        }),
      );
      await embedder.embed("text");
      expect(mockSleep).toHaveBeenCalledOnce();
      const [waitMs] = mockSleep.mock.calls[0] as [number];
      // Should wait at least ~9.5s (10s - small delta) plus 500ms buffer
      expect(waitMs).toBeGreaterThan(9_000);
    });

    it("does not sleep when x-ratelimit-remaining is positive", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeSuccessResponse([[0.1, 0.2, 0.3]], {
          "x-ratelimit-remaining": "5",
        }),
      );
      await embedder.embed("text");
      expect(mockSleep).not.toHaveBeenCalled();
    });

    it("throws immediately without sleeping when reset wait exceeds maxRetryWaitMs", async () => {
      const strict = new GitHubModelsEmbedder({
        token: "tok",
        maxRetryWaitMs: 30_000, // 30s limit
      });
      const resetAt = Math.floor(Date.now() / 1000) + 600; // 10 min from now
      vi.mocked(fetch).mockResolvedValue(
        makeSuccessResponse([[0.1, 0.2, 0.3]], {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(resetAt),
        }),
      );
      await expect(strict.embed("text")).rejects.toThrow("exceeds maxRetryWaitMs");
      expect(mockSleep).not.toHaveBeenCalled();
    });

    it("sleeps until reset when wait is within maxRetryWaitMs", async () => {
      const resetAt = Math.floor(Date.now() / 1000) + 10; // 10s from now
      vi.mocked(fetch).mockResolvedValue(
        makeSuccessResponse([[0.1, 0.2, 0.3]], {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(resetAt),
        }),
      );
      // default maxRetryWaitMs is 5min — 10s is within limit
      await embedder.embed("text");
      expect(mockSleep).toHaveBeenCalledOnce();
    });
  });

  describe("429 handling", () => {
    it("sleeps for retry-after seconds then throws so withRetry can retry", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeErrorResponse(
          429,
          { error: "rate limited" },
          { "retry-after": "30" },
        ),
      );
      await expect(embedder.embed("text")).rejects.toThrow("429");
      expect(mockSleep).toHaveBeenCalledWith(30_000);
    });

    it("defaults to 60s sleep when retry-after header is absent", async () => {
      vi.mocked(fetch).mockResolvedValue(makeErrorResponse(429, {}));
      await expect(embedder.embed("text")).rejects.toThrow();
      expect(mockSleep).toHaveBeenCalledWith(60_000);
    });

    it("throws immediately without sleeping when retry-after exceeds maxRetryWaitMs", async () => {
      const strict = new GitHubModelsEmbedder({
        token: "tok",
        maxRetryWaitMs: 10_000, // 10s limit
      });
      vi.mocked(fetch).mockResolvedValue(
        makeErrorResponse(429, {}, { "retry-after": "120" }), // 120s > 10s
      );
      await expect(strict.embed("text")).rejects.toThrow("exceeds maxRetryWaitMs");
      expect(mockSleep).not.toHaveBeenCalled();
    });

    it("sleeps and throws when retry-after is within maxRetryWaitMs", async () => {
      const strict = new GitHubModelsEmbedder({
        token: "tok",
        maxRetryWaitMs: 120_000, // 2 min limit
      });
      vi.mocked(fetch).mockResolvedValue(
        makeErrorResponse(429, {}, { "retry-after": "30" }), // 30s < 2min
      );
      await expect(strict.embed("text")).rejects.toThrow("429");
      expect(mockSleep).toHaveBeenCalledWith(30_000);
    });
  });

  describe("error handling", () => {
    it("throws with status and body for non-ok responses", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeErrorResponse(403, {
          error: { code: "no_access", message: "No access to model" },
        }),
      );
      await expect(embedder.embed("text")).rejects.toThrow("403");
    });

    it("includes response body in the error message", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeErrorResponse(500, { error: { message: "internal error" } }),
      );
      await expect(embedder.embed("text")).rejects.toThrow("internal error");
    });
  });

  describe("constructor options", () => {
    it("uses default model and endpoint when not specified", async () => {
      vi.mocked(fetch).mockResolvedValue(
        makeSuccessResponse([[0.1, 0.2, 0.3]]),
      );
      await embedder.embed("text");
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toContain("models.github.ai");
      expect(JSON.parse(init.body as string).model).toBe(
        "openai/text-embedding-3-small",
      );
    });

    it("uses custom model and endpoint when specified", async () => {
      const custom = new GitHubModelsEmbedder({
        token: "tok",
        model: "custom/model",
        endpoint: "https://custom.example.com/embeddings",
      });
      vi.mocked(fetch).mockResolvedValue(makeSuccessResponse([[0.1]]));
      await custom.embed("text");
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe("https://custom.example.com/embeddings");
      expect(JSON.parse(init.body as string).model).toBe("custom/model");
    });

    it("reflects configured dimensions", () => {
      const e = new GitHubModelsEmbedder({ token: "t", dimensions: 512 });
      expect(e.dimensions).toBe(512);
    });
  });
});
