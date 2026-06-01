export {
  PostgresVectorStore,
  type PostgresVectorStoreOptions,
  type IndexType,
  type IVFFlatParams,
  type HNSWParams,
} from "./store.js";

import type { VectorStore } from "@vivantel/rag-core";
import { PostgresVectorStore } from "./store.js";

/** Factory used by the JSON config loader. */
export function createVectorStore(
  config: Record<string, unknown>,
): VectorStore {
  const connectionString = config.connectionString;
  if (typeof connectionString !== "string" || !connectionString) {
    throw new Error(
      "@vivantel/rag-store-postgres: config.connectionString is required",
    );
  }
  return new PostgresVectorStore({
    connectionString,
    table: typeof config.table === "string" ? config.table : undefined,
    dimensions:
      typeof config.dimensions === "number" ? config.dimensions : undefined,
    ssl: typeof config.ssl === "boolean" ? config.ssl : undefined,
  });
}
