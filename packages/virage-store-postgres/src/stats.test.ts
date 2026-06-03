import { describe, it, expect, vi } from "vitest";
import { getIndexStats } from "./stats.js";
import type pg from "pg";

// Query call order inside getIndexStats / computeIndexStats / computeAnnRecall:
//   1. COUNT(*) from table                        (computeIndexStats)
//   2. pg_indexes WHERE tablename = $1            (computeIndexStats)
//   3. pg_stat_user_tables WHERE relname = $1     (computeIndexStats)
//   4. information_schema.columns (embedding?)    (computeAnnRecall)
//   5. COUNT(*) from table  (only when col found) (computeAnnRecall)
//   6. array_length(embedding, 1)                 (computeAnnRecall, count ≥ 10)
//   7. exact ORDER BY embedding::vector <=>       (computeAnnRecall)
//   8. ANN  ORDER BY embedding <=>               (computeAnnRecall)

type Row = Record<string, unknown>;

function makePool(queryResults: { rows: Row[] }[]) {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  for (const result of queryResults) {
    client.query.mockResolvedValueOnce(result);
  }
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as pg.Pool;
  return { pool, client };
}

const STAT_ROW_CLEAN = {
  n_live_tup: "500",
  n_dead_tup: "0",
  last_vacuum: null,
  last_autovacuum: null,
};

// Minimal 4-query sequence: no ANN recall (embedding column absent)
function noAnnResponses(
  count: number,
  indexRows: Row[] = [],
  statRow: Row = STAT_ROW_CLEAN,
) {
  return [
    { rows: [{ count: String(count) }] },
    { rows: indexRows },
    { rows: [statRow] },
    { rows: [] }, // no embedding column
  ];
}

// 8-query sequence including full ANN recall
function withAnnResponses(
  count: number,
  indexRows: Row[],
  statRow: Row,
  dim: number,
  exactIds: number[],
  annIds: number[],
) {
  return [
    { rows: [{ count: String(count) }] },
    { rows: indexRows },
    { rows: [statRow] },
    { rows: [{ data_type: "USER-DEFINED" }] }, // embedding column present
    { rows: [{ count: String(count) }] },
    { rows: [{ dim }] },
    { rows: exactIds.map((id) => ({ id })) },
    { rows: annIds.map((id) => ({ id })) },
  ];
}

describe("getIndexStats (PostgreSQL)", () => {
  describe("totalVectors", () => {
    it("reflects the COUNT query result", async () => {
      const { pool } = makePool(noAnnResponses(1234));

      const stats = await getIndexStats(pool, "documents");

      expect(stats.totalVectors).toBe(1234);
    });

    it("is 0 when the table is empty", async () => {
      const { pool } = makePool(noAnnResponses(0));

      const stats = await getIndexStats(pool, "documents");

      expect(stats.totalVectors).toBe(0);
    });
  });

  describe("indexType detection", () => {
    it("detects hnsw from pg_indexes indexdef", async () => {
      const { pool } = makePool(
        noAnnResponses(100, [
          {
            indexname: "emb_idx",
            indexdef: "CREATE INDEX emb_idx USING hnsw (embedding)",
          },
        ]),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.indexType).toBe("hnsw");
    });

    it("detects ivfflat from pg_indexes indexdef", async () => {
      const { pool } = makePool(
        noAnnResponses(100, [
          {
            indexname: "emb_idx",
            indexdef: "CREATE INDEX emb_idx USING ivfflat (embedding)",
          },
        ]),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.indexType).toBe("ivfflat");
    });

    it("detects flat from btree indexdef", async () => {
      const { pool } = makePool(
        noAnnResponses(100, [
          {
            indexname: "pkey",
            indexdef: "CREATE UNIQUE INDEX pkey USING btree (id)",
          },
        ]),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.indexType).toBe("flat");
    });

    it("is unknown when pg_indexes returns no rows", async () => {
      const { pool } = makePool(noAnnResponses(100, []));

      const stats = await getIndexStats(pool, "documents");

      expect(stats.indexType).toBe("unknown");
    });

    it("uses the first matching index row (first-match order)", async () => {
      // hnsw row comes first → detected as hnsw even though ivfflat row also present
      const { pool } = makePool(
        noAnnResponses(100, [
          {
            indexname: "hnsw_idx",
            indexdef: "CREATE INDEX USING hnsw (embedding)",
          },
          {
            indexname: "ivf_idx",
            indexdef: "CREATE INDEX USING ivfflat (embedding)",
          },
        ]),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.indexType).toBe("hnsw");
    });
  });

  describe("deadTupleFraction", () => {
    it("is computed as dead / (live + dead)", async () => {
      const { pool } = makePool(
        noAnnResponses(100, [], {
          n_live_tup: "300",
          n_dead_tup: "100",
          last_vacuum: null,
          last_autovacuum: null,
        }),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.deadTupleFraction).toBeCloseTo(0.25, 2);
    });

    it("is 0 when no tuples exist", async () => {
      const { pool } = makePool(
        noAnnResponses(0, [], {
          n_live_tup: "0",
          n_dead_tup: "0",
          last_vacuum: null,
          last_autovacuum: null,
        }),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.deadTupleFraction).toBe(0);
    });
  });

  describe("indexAgeHours", () => {
    it("is computed from last_vacuum when present", async () => {
      const lastVacuum = new Date(Date.now() - 2 * 3_600_000).toISOString();
      const { pool } = makePool(
        noAnnResponses(100, [], { ...STAT_ROW_CLEAN, last_vacuum: lastVacuum }),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.indexAgeHours).toBeGreaterThanOrEqual(1.9);
      expect(stats.indexAgeHours).toBeLessThanOrEqual(2.1);
    });

    it("falls back to last_autovacuum when last_vacuum is null", async () => {
      const lastAutoVacuum = new Date(Date.now() - 3 * 3_600_000).toISOString();
      const { pool } = makePool(
        noAnnResponses(100, [], {
          ...STAT_ROW_CLEAN,
          last_vacuum: null,
          last_autovacuum: lastAutoVacuum,
        }),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.indexAgeHours).toBeGreaterThanOrEqual(2.9);
      expect(stats.indexAgeHours).toBeLessThanOrEqual(3.1);
    });

    it("is -1 when both vacuum timestamps are null", async () => {
      const { pool } = makePool(noAnnResponses(100));

      const stats = await getIndexStats(pool, "documents");

      expect(stats.indexAgeHours).toBe(-1);
    });
  });

  describe("ANN recall", () => {
    it("is -1 when embedding column is absent", async () => {
      const { pool } = makePool(noAnnResponses(500));

      const stats = await getIndexStats(pool, "documents");

      expect(stats.annRecallAt10).toBe(-1);
    });

    it("is -1 when table has fewer than 10 rows", async () => {
      const { pool } = makePool([
        { rows: [{ count: "5" }] },
        { rows: [] },
        { rows: [STAT_ROW_CLEAN] },
        { rows: [{ data_type: "USER-DEFINED" }] }, // embedding col present
        { rows: [{ count: "5" }] }, // but count < 10
      ]);

      const stats = await getIndexStats(pool, "documents");

      expect(stats.annRecallAt10).toBe(-1);
    });

    it("is -1 when dim query returns null", async () => {
      const { pool } = makePool([
        { rows: [{ count: "100" }] },
        { rows: [] },
        { rows: [STAT_ROW_CLEAN] },
        { rows: [{ data_type: "USER-DEFINED" }] },
        { rows: [{ count: "100" }] },
        { rows: [{ dim: null }] }, // no dim
      ]);

      const stats = await getIndexStats(pool, "documents");

      expect(stats.annRecallAt10).toBe(-1);
    });

    it("is 1.0 when ANN and exact results are identical", async () => {
      const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const { pool } = makePool(
        withAnnResponses(100, [], STAT_ROW_CLEAN, 4, ids, ids),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.annRecallAt10).toBe(1);
    });

    it("computes partial recall correctly", async () => {
      const exactIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const annIds = [1, 2, 3, 4, 5, 11, 12, 13, 14, 15]; // 5 hits
      const { pool } = makePool(
        withAnnResponses(100, [], STAT_ROW_CLEAN, 4, exactIds, annIds),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.annRecallAt10).toBeCloseTo(0.5, 5);
    });

    it("is -1 when the search query throws", async () => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ count: "100" }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [STAT_ROW_CLEAN] })
          .mockResolvedValueOnce({ rows: [{ data_type: "USER-DEFINED" }] })
          .mockResolvedValueOnce({ rows: [{ count: "100" }] })
          .mockResolvedValueOnce({ rows: [{ dim: 4 }] })
          .mockRejectedValueOnce(new Error("operator does not exist")),
        release: vi.fn(),
      };
      const pool = {
        connect: vi.fn().mockResolvedValue(client),
      } as unknown as pg.Pool;

      const stats = await getIndexStats(pool, "documents");

      expect(stats.annRecallAt10).toBe(-1);
    });
  });

  describe("suggestions", () => {
    it("recommends REINDEX when dead tuple fraction > 10%", async () => {
      const { pool } = makePool(
        noAnnResponses(100, [], {
          n_live_tup: "800",
          n_dead_tup: "200",
          last_vacuum: null,
          last_autovacuum: null,
        }),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.suggestions.some((s) => /REINDEX/i.test(s))).toBe(true);
    });

    it("suggests switching to HNSW for ivfflat index with > 100k vectors", async () => {
      const { pool } = makePool(
        noAnnResponses(150_000, [
          {
            indexname: "idx",
            indexdef: "CREATE INDEX USING ivfflat (embedding)",
          },
        ]),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.suggestions.some((s) => /HNSW/i.test(s))).toBe(true);
    });

    it("does not suggest HNSW for hnsw index with > 100k vectors", async () => {
      const { pool } = makePool(
        noAnnResponses(150_000, [
          { indexname: "idx", indexdef: "CREATE INDEX USING hnsw (embedding)" },
        ]),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.suggestions.every((s) => !/switch.*HNSW/i.test(s))).toBe(
        true,
      );
    });

    it("suggests VACUUM ANALYZE when index is older than 168 hours", async () => {
      const old = new Date(Date.now() - 200 * 3_600_000).toISOString();
      const { pool } = makePool(
        noAnnResponses(100, [], { ...STAT_ROW_CLEAN, last_vacuum: old }),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.suggestions.some((s) => /VACUUM/i.test(s))).toBe(true);
    });

    it("returns healthy suggestion when no issues detected", async () => {
      const { pool } = makePool(
        noAnnResponses(100, [
          { indexname: "idx", indexdef: "CREATE INDEX USING hnsw (embedding)" },
        ]),
      );

      const stats = await getIndexStats(pool, "documents");

      expect(stats.suggestions[0]).toMatch(/healthy/i);
    });
  });

  describe("client lifecycle", () => {
    it("releases the client even when a query throws", async () => {
      const client = {
        query: vi.fn().mockRejectedValue(new Error("connection lost")),
        release: vi.fn(),
      };
      const pool = {
        connect: vi.fn().mockResolvedValue(client),
      } as unknown as pg.Pool;

      await expect(getIndexStats(pool, "documents")).rejects.toThrow(
        "connection lost",
      );

      expect(client.release).toHaveBeenCalledOnce();
    });
  });
});
