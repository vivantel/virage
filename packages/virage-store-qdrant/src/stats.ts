import type { IndexStats } from "@vivantel/virage-core";
import type { QdrantClient } from "@qdrant/js-client-rest";

type CollectionInfo = Awaited<ReturnType<QdrantClient["getCollection"]>>;

export async function getIndexStats(
  client: QdrantClient,
  collection: string,
): Promise<IndexStats> {
  const info = await client.getCollection(collection);
  const suggestions: string[] = [];

  const totalVectors = info.points_count ?? 0;
  const segmentsCount = info.segments_count ?? 0;

  // Qdrant always uses HNSW internally
  const indexType: IndexStats["indexType"] = "hnsw";

  if (info.status === "red") {
    suggestions.push(
      `Collection status is RED — check Qdrant logs for errors in "${collection}"`,
    );
  } else if (info.status === "yellow") {
    suggestions.push(
      `Collection status is YELLOW — indexing may be in progress for "${collection}"`,
    );
  }

  if (segmentsCount > 20) {
    suggestions.push(
      `High segment count (${segmentsCount}) — consider running collection optimization to merge segments`,
    );
  }

  const annRecallAt10 = await computeAnnRecall(
    client,
    collection,
    info,
    totalVectors,
  );

  if (suggestions.length === 0) {
    suggestions.push("Collection looks healthy");
  }

  return {
    totalVectors,
    indexType,
    annRecallAt10,
    // Not applicable for Qdrant (no vacuum/dead-tuple concept)
    indexAgeHours: 0,
    deadTupleFraction: 0,
    suggestions,
  };
}

function extractVectorSize(info: CollectionInfo): number | undefined {
  const vectors = info.config?.params?.vectors;
  if (!vectors) return undefined;
  // Single-vector mode: { size: number, distance: ... }
  if (
    "size" in vectors &&
    typeof (vectors as { size: unknown }).size === "number"
  ) {
    return (vectors as { size: number }).size;
  }
  // Named-vector mode: { default: { size: number, ... }, ... }
  const firstNamed = Object.values(
    vectors as Record<string, { size?: number }>,
  )[0];
  return typeof firstNamed?.size === "number" ? firstNamed.size : undefined;
}

async function computeAnnRecall(
  client: QdrantClient,
  collection: string,
  info: CollectionInfo,
  totalVectors: number,
): Promise<number> {
  if (totalVectors < 10) return -1;

  const size = extractVectorSize(info);
  if (!size) return -1;

  try {
    const zeroVector = Array<number>(size).fill(0);

    const [exactResults, annResults] = await Promise.all([
      client.search(collection, {
        vector: zeroVector,
        limit: 10,
        params: { exact: true },
        with_payload: false,
      }),
      client.search(collection, {
        vector: zeroVector,
        limit: 10,
        params: { exact: false },
        with_payload: false,
      }),
    ]);

    const exactIds = new Set(exactResults.map((r) => String(r.id)));
    const annIds = annResults.map((r) => String(r.id));
    const hits = annIds.filter((id) => exactIds.has(id)).length;
    return hits / Math.max(exactIds.size, 1);
  } catch {
    return -1;
  }
}
