export { LanceDBVectorStore, type LanceDBVectorStoreOptions } from "./store.js";

import type { VectorStore } from "@vivantel/virage-core";
import { LanceDBVectorStore } from "./store.js";

/** Factory used by the JSON config loader. */
export function createVectorStore(
  config: Record<string, unknown>,
): VectorStore {
  const uri = typeof config.uri === "string" ? config.uri : undefined;
  if (!uri) {
    throw new Error(
      '@vivantel/virage-store-lancedb: config.uri is required (e.g. "./lancedb" for local file storage)',
    );
  }
  return new LanceDBVectorStore({
    uri,
    apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined,
    tableName:
      typeof config.tableName === "string" ? config.tableName : undefined,
    dimensions:
      typeof config.dimensions === "number" ? config.dimensions : undefined,
  });
}
