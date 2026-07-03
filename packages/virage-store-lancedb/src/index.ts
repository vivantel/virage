export { LanceDBVectorStore, type LanceDBVectorStoreOptions } from "./store.js";

import { z } from "zod";
import type { VectorStore } from "@vivantel/virage-core";
import { LanceDBVectorStore } from "./store.js";

export const optionsSchema = z.object({
  uri: z
    .string()
    .min(1)
    .describe("LanceDB URI (local path or s3://... / lancedb+s3://...)"),
  apiKey: z.string().optional().describe("LanceDB Cloud API key"),
  tableName: z.string().optional().describe("Override default table name"),
  dimensions: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Embedding dimensions (inferred from embedder)"),
});
export type PluginOptions = z.infer<typeof optionsSchema>;

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
