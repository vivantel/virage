export { QdrantVectorStore, type QdrantVectorStoreOptions } from "./store.js";

import { z } from "zod";
import type { VectorStore } from "@vivantel/virage-core";
import { QdrantVectorStore } from "./store.js";

export const optionsSchema = z
  .object({
    url: z
      .string()
      .optional()
      .describe("Qdrant server URL (e.g. http://localhost:6333)"),
    path: z.string().optional().describe("Qdrant local storage path"),
    port: z.number().int().positive().optional(),
    apiKey: z.string().optional(),
    collection: z.string().optional().describe("Qdrant collection name"),
    dimensions: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Embedding dimensions (inferred from embedder)"),
  })
  .refine((o) => o.url !== undefined || o.path !== undefined, {
    message: "Either url or path is required",
  });
export type PluginOptions = z.infer<typeof optionsSchema>;

/** Factory used by the JSON config loader. */
export function createVectorStore(
  config: Record<string, unknown>,
): VectorStore {
  const url = typeof config.url === "string" ? config.url : undefined;
  const path = typeof config.path === "string" ? config.path : undefined;
  if (!url && !path) {
    throw new Error(
      "@vivantel/virage-store-qdrant: config.url or config.path is required",
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
