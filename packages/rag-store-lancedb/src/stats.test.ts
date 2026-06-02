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
  describe("empty table", () => {
    it("returns flat indexType and empty-table suggestion when table has no rows", async () => {
      const table = makeTable({ countRows: vi.fn().mockResolvedValue(0) });

      const stats = await getIndexStats(table);

      expect(stats.totalVectors).toBe(0);
      expect(stats.indexType).toBe("flat");
      expect(stats.suggestions[0]).toMatch(/empty/i);
    });
  });

  describe("flat index with various vector counts", () => {
    it("returns healthy suggestion for a small table (≤ 10 000 vectors, no index)", async () => {
      const stats = await getIndexStats(makeTable({ countRows: vi.fn().mockResolvedValue(500) }));
      expect(stats.suggestions[0]).toMatch(/healthy/i);
    });

    it("returns healthy suggestion at exactly 10 000 vectors (boundary)", async () => {
      const stats = await getIndexStats(makeTable({ countRows: vi.fn().mockResolvedValue(10_000) }));
      expect(stats.suggestions[0]).toMatch(/healthy/i);
    });

    it("suggests creating an IVF-PQ index when > 10 000 vectors and no index", async () => {
      const stats = await getIndexStats(makeTable({ countRows: vi.fn().mockResolvedValue(15_000) }));

      expect(stats.totalVectors).toBe(15_000);
      expect(stats.indexType).toBe("flat");
      expect(stats.suggestions[0]).toMatch(/IVF-PQ/i);
    });
  });

  describe("index type detection via listIndices", () => {
    it("detects hnsw from HNSW indexType", async () => {
      const table = makeTable({
        countRows: vi.fn().mockResolvedValue(1000),
        listIndices: vi.fn().mockResolvedValue([{ name: "emb_idx", indexType: "HNSW" }]),
      });

      const stats = await getIndexStats(table);

      expect(stats.indexType).toBe("hnsw");
      expect(stats.suggestions[0]).toMatch(/healthy/i);
    });

    it("detects ivfflat from IVF_PQ indexType", async () => {
      const table = makeTable({
        countRows: vi.fn().mockResolvedValue(20_000),
        listIndices: vi.fn().mockResolvedValue([{ name: "emb_idx", indexType: "IVF_PQ" }]),
      });

      const stats = await getIndexStats(table);

      expect(stats.indexType).toBe("ivfflat");
      // Has a real index → should be healthy, not suggest IVF-PQ creation
      expect(stats.suggestions[0]).toMatch(/healthy/i);
    });

    it("does not suggest IVF-PQ creation when a non-flat index is present (even > 10k)", async () => {
      const table = makeTable({
        countRows: vi.fn().mockResolvedValue(50_000),
        listIndices: vi.fn().mockResolvedValue([{ name: "idx", indexType: "IVF_PQ" }]),
      });

      const stats = await getIndexStats(table);

      expect(stats.suggestions.every((s) => !/IVF-PQ creation/i.test(s))).toBe(true);
    });

    it("falls back to flat when listIndices throws", async () => {
      const table = makeTable({
        countRows: vi.fn().mockResolvedValue(500),
        listIndices: vi.fn().mockRejectedValue(new Error("not supported")),
      });

      const stats = await getIndexStats(table);

      expect(stats.indexType).toBe("flat");
    });

    it("falls back to flat when listIndices returns an empty array", async () => {
      const table = makeTable({
        countRows: vi.fn().mockResolvedValue(500),
        listIndices: vi.fn().mockResolvedValue([]),
      });

      const stats = await getIndexStats(table);

      expect(stats.indexType).toBe("flat");
    });
  });

  describe("fixed metadata fields", () => {
    it("always returns annRecallAt10 = -1, indexAgeHours = -1, deadTupleFraction = 0", async () => {
      const stats = await getIndexStats(makeTable({ countRows: vi.fn().mockResolvedValue(100) }));

      expect(stats.annRecallAt10).toBe(-1);
      expect(stats.indexAgeHours).toBe(-1);
      expect(stats.deadTupleFraction).toBe(0);
    });
  });
});
