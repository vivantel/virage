import { describe, it, expect } from "vitest";
import {
  batchArray,
  batchBySize,
  withRetry,
  defaultIsRetryable,
} from "./utils.js";

describe("batchArray", () => {
  it("splits evenly", () => {
    expect(batchArray([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("last batch is smaller when count is not divisible", () => {
    expect(batchArray([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it("returns empty array for empty input", () => {
    expect(batchArray([], 5)).toEqual([]);
  });
});

describe("batchBySize", () => {
  const sizeOf = (s: string) => s.length;

  it("splits by item count when size limit is not reached", () => {
    const items = ["a", "b", "c", "d"];
    const batches = batchBySize(items, 2, sizeOf, Infinity);
    expect(batches).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("splits by total size when item count limit is not reached", () => {
    // Each string is 10 chars; maxSize=25 means max 2 per batch before closing
    const items = ["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc", "dddddddddd"];
    const batches = batchBySize(items, 100, sizeOf, 25);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2); // 10+10=20 ≤ 25; adding third (30) exceeds
    expect(batches[1]).toHaveLength(2);
  });

  it("closes batch before adding an item that would exceed maxSize", () => {
    const items = ["aa", "bb", "cccc"]; // 2, 2, 4
    const batches = batchBySize(items, 10, sizeOf, 5);
    // "aa"(2) + "bb"(2) = 4 ≤ 5; adding "cccc"(4) → 8 > 5 → new batch
    expect(batches).toEqual([["aa", "bb"], ["cccc"]]);
  });

  it("item count and size limits both active — whichever triggers first wins", () => {
    const items = ["aa", "bb", "cc", "dd"]; // 2 chars each
    const batches = batchBySize(items, 2, sizeOf, 100);
    // count limit (2) triggers before size limit
    expect(batches).toEqual([
      ["aa", "bb"],
      ["cc", "dd"],
    ]);
  });

  it("places an oversized single item in its own batch rather than dropping it", () => {
    const items = ["tiny", "x".repeat(1000), "tiny2"];
    const batches = batchBySize(items, 10, sizeOf, 50);
    expect(batches[1]).toEqual(["x".repeat(1000)]);
  });

  it("returns empty array for empty input", () => {
    expect(batchBySize([], 5, sizeOf, 100)).toEqual([]);
  });

  it("single item fits in one batch", () => {
    expect(batchBySize(["hello"], 10, sizeOf, 100)).toEqual([["hello"]]);
  });

  it("works with numeric items via a custom size function", () => {
    const nums = [10, 20, 30, 5];
    const batches = batchBySize(nums, 10, (n) => n, 35);
    // 10+20=30 ≤ 35; 30+30=60 > 35 → new batch; 30+5=35 ≤ 35
    expect(batches).toEqual([
      [10, 20],
      [30, 5],
    ]);
  });
});

describe("defaultIsRetryable", () => {
  it("returns false for Access Denied", () => {
    expect(defaultIsRetryable(new Error("Access Denied"))).toBe(false);
  });

  it("returns false for Forbidden", () => {
    expect(defaultIsRetryable(new Error("403 Forbidden"))).toBe(false);
  });

  it("returns false for Unauthorized", () => {
    expect(defaultIsRetryable(new Error("401 Unauthorized"))).toBe(false);
  });

  it("returns false for Not Found", () => {
    expect(defaultIsRetryable(new Error("404 Not Found"))).toBe(false);
  });

  it("returns false for arbitrary 4xx except 429", () => {
    expect(defaultIsRetryable(new Error("HTTP 400 Bad Request"))).toBe(false);
    expect(defaultIsRetryable(new Error("HTTP 410 Gone"))).toBe(false);
  });

  it("returns true for 429 Too Many Requests", () => {
    expect(defaultIsRetryable(new Error("HTTP 429 Too Many Requests"))).toBe(
      true,
    );
  });

  it("returns true for 5xx errors", () => {
    expect(
      defaultIsRetryable(new Error("HTTP 500 Internal Server Error")),
    ).toBe(true);
    expect(defaultIsRetryable(new Error("503 Service Unavailable"))).toBe(true);
  });

  it("returns true for network errors", () => {
    expect(defaultIsRetryable(new Error("ECONNRESET"))).toBe(true);
    expect(defaultIsRetryable(new Error("fetch failed"))).toBe(true);
  });
});

describe("withRetry with isRetryable", () => {
  it("does not retry when isRetryable returns false", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("Access Denied");
    };
    await expect(
      withRetry(fn, { maxRetries: 3, isRetryable: defaultIsRetryable }),
    ).rejects.toThrow("Access Denied");
    expect(calls).toBe(1);
  });

  it("retries up to maxRetries for retryable errors", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("fetch failed");
    };
    await expect(
      withRetry(fn, {
        maxRetries: 2,
        retryDelayMs: 0,
        isRetryable: defaultIsRetryable,
      }),
    ).rejects.toThrow("fetch failed");
    expect(calls).toBe(3);
  });
});
