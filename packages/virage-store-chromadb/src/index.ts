export { ChromaVectorStore, type ChromaVectorStoreOptions } from "./store.js";

import { z } from "zod";
import type { VectorStore } from "@vivantel/virage-core";
import { ChromaVectorStore } from "./store.js";

export const optionsSchema = z.object({
  path: z.string().optional().describe("ChromaDB server URL or local path"),
  collectionName: z.string().optional().describe("ChromaDB collection name"),
  dimensions: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Embedding dimensions (inferred from embedder)"),
  apiKey: z.string().optional().describe("ChromaDB Cloud API key"),
});
export type PluginOptions = z.infer<typeof optionsSchema>;

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
