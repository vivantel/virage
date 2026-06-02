import { describe, it, expect, vi } from "vitest";
import { getIndexStats } from "./stats.js";
import type { QdrantClient } from "@qdrant/js-client-rest";

type CollectionInfo = Awaited<ReturnType<QdrantClient["getCollection"]>>;

function makeCollectionInfo(
  overrides: Partial<CollectionInfo> = {},
): CollectionInfo {
  return {
    points_count: 100,
    segments_count: 3,
    status: "green",
    config: {
      params: {
        vectors: {
          size: 4,
          distance: "Cosine",
        } as unknown as CollectionInfo["config"]["params"]["vectors"],
        shard_number: 1,
        replication_factor: 1,
        write_consistency_factor: 1,
        on_disk_payload: false,
      },
      optimizer_config: {} as CollectionInfo["config"]["optimizer_config"],
      wal_config: {} as CollectionInfo["config"]["wal_config"],
      quantization_config: null,
    },
    ...overrides,
  } as CollectionInfo;
}

function makeClient(
  info: CollectionInfo,
  searchResults: { id: string | number; score: number }[][] = [[], []],
) {
  return {
    getCollection: vi.fn().mockResolvedValue(info),
    search: vi
      .fn()
      .mockResolvedValueOnce(searchResults[0] ?? [])
      .mockResolvedValueOnce(searchResults[1] ?? []),
  } as unknown as QdrantClient;
}

describe("getIndexStats (Qdrant)", () => {
  describe("basic fields", () => {
    it("always returns hnsw indexType", async () => {
      const client = makeClient(makeCollectionInfo());

      const stats = await getIndexStats(client, "documents");

      expect(stats.indexType).toBe("hnsw");
    });

    it("reflects points_count as totalVectors", async () => {
      const client = makeClient(makeCollectionInfo({ points_count: 4200 }));

      const stats = await getIndexStats(client, "documents");

      expect(stats.totalVectors).toBe(4200);
    });

    it("totalVectors defaults to 0 when points_count is undefined", async () => {
      const client = makeClient(
        makeCollectionInfo({ points_count: undefined }),
      );

      const stats = await getIndexStats(client, "documents");

      expect(stats.totalVectors).toBe(0);
    });

    it("always returns indexAgeHours = 0 and deadTupleFraction = 0", async () => {
      const client = makeClient(makeCollectionInfo());

      const stats = await getIndexStats(client, "documents");

      expect(stats.indexAgeHours).toBe(0);
      expect(stats.deadTupleFraction).toBe(0);
    });
  });

  describe("status warnings", () => {
    it("includes RED alert in suggestions when status is red", async () => {
      const client = makeClient(makeCollectionInfo({ status: "red" }));

      const stats = await getIndexStats(client, "documents");

      expect(stats.suggestions.some((s) => /RED/i.test(s))).toBe(true);
    });

    it("includes YELLOW warning in suggestions when status is yellow", async () => {
      const client = makeClient(makeCollectionInfo({ status: "yellow" }));

      const stats = await getIndexStats(client, "documents");

      expect(stats.suggestions.some((s) => /YELLOW/i.test(s))).toBe(true);
    });

    it("returns healthy suggestion when status is green and segments < 20", async () => {
      const client = makeClient(
        makeCollectionInfo({ status: "green", segments_count: 5 }),
      );

      const stats = await getIndexStats(client, "documents");

      expect(stats.suggestions[0]).toMatch(/healthy/i);
    });
  });

  describe("segment count", () => {
    it("suggests optimization when segments_count > 20", async () => {
      const client = makeClient(makeCollectionInfo({ segments_count: 25 }));

      const stats = await getIndexStats(client, "documents");

      expect(stats.suggestions.some((s) => /segment/i.test(s))).toBe(true);
    });

    it("does not warn about segments when count is exactly 20", async () => {
      const client = makeClient(makeCollectionInfo({ segments_count: 20 }));

      const stats = await getIndexStats(client, "documents");

      expect(stats.suggestions.every((s) => !/segment/i.test(s))).toBe(true);
    });
  });

  describe("ANN recall", () => {
    it("is -1 when totalVectors < 10", async () => {
      const client = makeClient(makeCollectionInfo({ points_count: 5 }));

      const stats = await getIndexStats(client, "documents");

      expect(stats.annRecallAt10).toBe(-1);
    });

    it("is -1 when vector size cannot be determined (no config)", async () => {
      const info = makeCollectionInfo({ points_count: 100 });
      (info as CollectionInfo & { config: null }).config = null as never;
      const client = makeClient(info);

      const stats = await getIndexStats(client, "documents");

      expect(stats.annRecallAt10).toBe(-1);
    });

    it("is 1.0 when exact and ANN results are identical (single-vector mode)", async () => {
      const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const resultSet = ids.map((id) => ({ id, score: 0.9 }));
      const client = makeClient(makeCollectionInfo({ points_count: 100 }), [
        resultSet,
        resultSet,
      ]);

      const stats = await getIndexStats(client, "documents");

      expect(stats.annRecallAt10).toBe(1);
    });

    it("computes partial recall correctly", async () => {
      const exactResults = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => ({
        id,
        score: 0.9,
      }));
      const annResults = [1, 2, 3, 4, 5, 11, 12, 13, 14, 15].map((id) => ({
        id,
        score: 0.85,
      }));
      const client = makeClient(makeCollectionInfo({ points_count: 100 }), [
        exactResults,
        annResults,
      ]);

      const stats = await getIndexStats(client, "documents");

      expect(stats.annRecallAt10).toBeCloseTo(0.5, 5);
    });

    it("supports named-vector mode for vector size extraction", async () => {
      const info = makeCollectionInfo({ points_count: 100 });
      // Override vectors to use named-vector mode
      (info.config!.params!.vectors as unknown as Record<string, unknown>) = {
        default: { size: 4, distance: "Cosine" },
      };
      const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const resultSet = ids.map((id) => ({ id, score: 0.9 }));
      const client = makeClient(info, [resultSet, resultSet]);

      const stats = await getIndexStats(client, "documents");

      expect(stats.annRecallAt10).toBe(1);
    });

    it("is -1 when search() throws", async () => {
      const client = {
        getCollection: vi
          .fn()
          .mockResolvedValue(makeCollectionInfo({ points_count: 100 })),
        search: vi.fn().mockRejectedValue(new Error("collection not found")),
      } as unknown as QdrantClient;

      const stats = await getIndexStats(client, "documents");

      expect(stats.annRecallAt10).toBe(-1);
    });
  });
});
