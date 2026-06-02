import type { IndexStats } from "@vivantel/rag-core";
import type { Collection } from "chromadb";

export async function getIndexStats(
  collection: Collection,
): Promise<IndexStats> {
  const totalVectors = await collection.count();
  const suggestions: string[] = [];

  if (totalVectors === 0) {
    suggestions.push("Collection is empty.");
  } else {
    suggestions.push(
      "ChromaDB uses HNSW internally — no manual reindex needed.",
    );
  }

  return {
    totalVectors,
    indexType: "hnsw",
    annRecallAt10: -1,
    indexAgeHours: -1,
    deadTupleFraction: 0,
    suggestions,
  };
}
