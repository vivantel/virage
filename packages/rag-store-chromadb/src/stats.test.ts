import { describe, it, expect, vi } from "vitest";
import { getIndexStats } from "./stats.js";
import type { Collection } from "chromadb";

function makeCollection(count: number): Collection {
  return {
    count: vi.fn().mockResolvedValue(count),
  } as unknown as Collection;
}

describe("getIndexStats (ChromaDB)", () => {
  it("returns hnsw indexType always", async () => {
    const stats = await getIndexStats(makeCollection(100));
    expect(stats.indexType).toBe("hnsw");
  });

  it("returns correct totalVectors from collection.count()", async () => {
    const stats = await getIndexStats(makeCollection(4200));
    expect(stats.totalVectors).toBe(4200);
  });

  it("suggestion mentions HNSW for non-empty collection", async () => {
    const stats = await getIndexStats(makeCollection(50));
    expect(stats.suggestions[0]).toMatch(/HNSW/i);
  });

  it("suggestion mentions empty for zero-count collection", async () => {
    const stats = await getIndexStats(makeCollection(0));
    expect(stats.suggestions[0]).toMatch(/empty/i);
  });

  it("always returns annRecallAt10 = -1 and indexAgeHours = -1", async () => {
    const stats = await getIndexStats(makeCollection(10));
    expect(stats.annRecallAt10).toBe(-1);
    expect(stats.indexAgeHours).toBe(-1);
    expect(stats.deadTupleFraction).toBe(0);
  });
});
