export { QdrantVectorStore, type QdrantVectorStoreOptions } from "./store.js";

import type { VectorStore } from "@vivantel/rag-core";
import { QdrantVectorStore } from "./store.js";

/** Factory used by the JSON config loader. */
export function createVectorStore(
  config: Record<string, unknown>,
): VectorStore {
  const url = config.url;
  if (typeof url !== "string" || !url) {
    throw new Error(
      "@vivantel/rag-store-qdrant: config.url is required (e.g. \"http://localhost:6333\")",
    );
  }
  return new QdrantVectorStore({
    url,
    apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined,
    collection:
      typeof config.collection === "string" ? config.collection : undefined,
    dimensions:
      typeof config.dimensions === "number" ? config.dimensions : undefined,
  });
}
