import { describe, it, expect, vi } from "vitest";
import { getIndexStats } from "./stats.js";
import type { Collection } from "chromadb";

function makeCollection(count: number): Collection {
  return {
    count: vi.fn().mockResolvedValue(count),
  } as unknown as Collection;
}

describe("getIndexStats (ChromaDB)", () => {
  it("always returns hnsw indexType", async () => {
    const stats = await getIndexStats(makeCollection(100));
    expect(stats.indexType).toBe("hnsw");
  });

  it("reflects the collection count as totalVectors", async () => {
    const stats = await getIndexStats(makeCollection(4200));
    expect(stats.totalVectors).toBe(4200);
  });

  it("totalVectors is 0 for an empty collection", async () => {
    const stats = await getIndexStats(makeCollection(0));
    expect(stats.totalVectors).toBe(0);
  });

  it("suggestion mentions HNSW for a non-empty collection", async () => {
    const stats = await getIndexStats(makeCollection(50));
    expect(stats.suggestions[0]).toMatch(/HNSW/i);
    expect(stats.suggestions[0]).not.toMatch(/empty/i);
  });

  it("suggestion mentions empty for a zero-count collection", async () => {
    const stats = await getIndexStats(makeCollection(0));
    expect(stats.suggestions[0]).toMatch(/empty/i);
  });

  it("always returns annRecallAt10 = -1, indexAgeHours = -1, deadTupleFraction = 0", async () => {
    const stats = await getIndexStats(makeCollection(10));
    expect(stats.annRecallAt10).toBe(-1);
    expect(stats.indexAgeHours).toBe(-1);
    expect(stats.deadTupleFraction).toBe(0);
  });

  it("returns exactly one suggestion", async () => {
    const stats = await getIndexStats(makeCollection(100));
    expect(stats.suggestions).toHaveLength(1);
  });
});
