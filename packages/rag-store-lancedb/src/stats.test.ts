import { describe, it, expect, vi } from "vitest";
import { getIndexStats } from "./stats.js";

function makeTable(overrides: Record<string, unknown> = {}) {
  return {
    countRows: vi.fn().mockResolvedValue(0),
    listIndices: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("getIndexStats (LanceDB)", () => {
  it("returns flat indexType and empty-table suggestion when table has no rows", async () => {
    const table = makeTable({ countRows: vi.fn().mockResolvedValue(0) });

    const stats = await getIndexStats(table);

    expect(stats.totalVectors).toBe(0);
    expect(stats.indexType).toBe("flat");
    expect(stats.suggestions[0]).toMatch(/empty/i);
  });

  it("suggests creating an IVF-PQ index when > 10 000 vectors and no index", async () => {
    const table = makeTable({ countRows: vi.fn().mockResolvedValue(15_000) });

    const stats = await getIndexStats(table);

    expect(stats.totalVectors).toBe(15_000);
    expect(stats.indexType).toBe("flat");
    expect(stats.suggestions[0]).toMatch(/IVF-PQ/i);
  });

  it("returns healthy suggestion when ≤ 10 000 vectors", async () => {
    const table = makeTable({ countRows: vi.fn().mockResolvedValue(500) });

    const stats = await getIndexStats(table);

    expect(stats.suggestions[0]).toMatch(/healthy/i);
  });

  it("detects hnsw indexType from listIndices", async () => {
    const table = makeTable({
      countRows: vi.fn().mockResolvedValue(1000),
      listIndices: vi.fn().mockResolvedValue([{ name: "emb_idx", indexType: "HNSW" }]),
    });

    const stats = await getIndexStats(table);

    expect(stats.indexType).toBe("hnsw");
  });

  it("detects ivfflat indexType from listIndices", async () => {
    const table = makeTable({
      countRows: vi.fn().mockResolvedValue(20_000),
      listIndices: vi.fn().mockResolvedValue([{ name: "emb_idx", indexType: "IVF_PQ" }]),
    });

    const stats = await getIndexStats(table);

    expect(stats.indexType).toBe("ivfflat");
  });

  it("falls back to flat when listIndices throws", async () => {
    const table = makeTable({
      countRows: vi.fn().mockResolvedValue(500),
      listIndices: vi.fn().mockRejectedValue(new Error("not supported")),
    });

    const stats = await getIndexStats(table);

    expect(stats.indexType).toBe("flat");
  });

  it("always returns annRecallAt10 = -1 and indexAgeHours = -1", async () => {
    const table = makeTable({ countRows: vi.fn().mockResolvedValue(100) });

    const stats = await getIndexStats(table);

    expect(stats.annRecallAt10).toBe(-1);
    expect(stats.indexAgeHours).toBe(-1);
    expect(stats.deadTupleFraction).toBe(0);
  });
});
