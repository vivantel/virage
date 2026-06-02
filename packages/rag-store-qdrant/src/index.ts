export { QdrantVectorStore, type QdrantVectorStoreOptions } from "./store.js";

import type { VectorStore } from "@vivantel/rag-core";
import { QdrantVectorStore } from "./store.js";

/** Factory used by the JSON config loader. */
export function createVectorStore(
  config: Record<string, unknown>,
): VectorStore {
  const url = typeof config.url === "string" ? config.url : undefined;
  const path = typeof config.path === "string" ? config.path : undefined;
  if (!url && !path) {
    throw new Error(
      "@vivantel/rag-store-qdrant: config.url or config.path is required",
    );
  }
  return new QdrantVectorStore({
    url,
    path,
    port: typeof config.port === "number" ? config.port : undefined,
    apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined,
    collection:
      typeof config.collection === "string" ? config.collection : undefined,
    dimensions:
      typeof config.dimensions === "number" ? config.dimensions : undefined,
  });
}
