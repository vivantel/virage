import type { IndexStats } from "@vivantel/rag-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getIndexStats(table: any): Promise<IndexStats> {
  const totalVectors = (await table.countRows()) as number;
  const suggestions: string[] = [];

  let indexType: IndexStats["indexType"] = "flat";

  try {
    const indices = (await table.listIndices()) as Array<{
      name?: string;
      indexType?: string;
    }>;
    if (indices.length > 0) {
      const types = indices.map((i) => (i.indexType ?? "").toLowerCase());
      if (types.some((t) => t.includes("hnsw"))) {
        indexType = "hnsw";
      } else if (types.some((t) => t.includes("ivf"))) {
        indexType = "ivfflat";
      }
    }
  } catch {
    // listIndices unavailable — assume flat
  }

  if (totalVectors === 0) {
    suggestions.push("Table is empty.");
  } else if (totalVectors > 10_000 && indexType === "flat") {
    suggestions.push(
      `Table has ${totalVectors.toLocaleString()} vectors on a flat index. ` +
        `Consider creating an IVF-PQ index for faster searches.`,
    );
  } else {
    suggestions.push("Index looks healthy.");
  }

  return {
    totalVectors,
    indexType,
    annRecallAt10: -1,
    indexAgeHours: -1,
    deadTupleFraction: 0,
    suggestions,
  };
}
