export {
  PostgresVectorStore,
  type PostgresVectorStoreOptions,
  type IndexType,
  type IVFFlatParams,
  type HNSWParams,
} from "./store.js";

import { z } from "zod";
import type { VectorStore } from "@vivantel/virage-core";
import { PostgresVectorStore } from "./store.js";

export const optionsSchema = z.object({
  connectionString: z
    .string()
    .min(1)
    .describe("PostgreSQL connection string (postgresql://...)"),
  table: z.string().optional().describe("Override default table name"),
  dimensions: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Embedding dimensions (inferred from embedder)"),
  ssl: z.boolean().optional(),
});
export type PluginOptions = z.infer<typeof optionsSchema>;

/** Factory used by the JSON config loader. */
export function createVectorStore(
  config: Record<string, unknown>,
): VectorStore {
  const connectionString = config.connectionString;
  if (typeof connectionString !== "string" || !connectionString) {
    throw new Error(
      "@vivantel/virage-store-postgres: config.connectionString is required",
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
