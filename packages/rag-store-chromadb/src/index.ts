export { ChromaVectorStore, type ChromaVectorStoreOptions } from "./store.js";

import type { VectorStore } from "@vivantel/rag-core";
import { ChromaVectorStore } from "./store.js";

/** Factory used by the JSON config loader. */
export function createVectorStore(
  config: Record<string, unknown>,
): VectorStore {
  return new ChromaVectorStore({
    path: typeof config.path === "string" ? config.path : undefined,
    collectionName:
      typeof config.collectionName === "string"
        ? config.collectionName
        : undefined,
    dimensions:
      typeof config.dimensions === "number" ? config.dimensions : undefined,
    apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined,
  });
}
