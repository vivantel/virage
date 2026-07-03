export {
  FastEmbedEmbedder,
  type FastEmbedEmbedderOptions,
} from "./embedder.js";

import { z } from "zod";
import type { EmbeddingProvider } from "@vivantel/virage-core";
import {
  FastEmbedEmbedder,
  type FastEmbedEmbedderOptions,
} from "./embedder.js";

export const optionsSchema = z.object({
  model: z.string().optional().describe("FastEmbed model name"),
  dimensions: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Output vector dimensions"),
  cacheDir: z
    .string()
    .optional()
    .describe("Directory to cache downloaded models"),
  showDownloadProgress: z.boolean().optional(),
});
export type PluginOptions = z.infer<typeof optionsSchema>;

/** Factory used by the JSON config loader. */
export function createEmbedder(
  config: Record<string, unknown>,
): EmbeddingProvider {
  const opts: FastEmbedEmbedderOptions = {
    model: typeof config.model === "string" ? config.model : undefined,
    dimensions:
      typeof config.dimensions === "number" ? config.dimensions : undefined,
    cacheDir: typeof config.cacheDir === "string" ? config.cacheDir : undefined,
    showDownloadProgress:
      typeof config.showDownloadProgress === "boolean"
        ? config.showDownloadProgress
        : undefined,
  };

  return new FastEmbedEmbedder(opts);
}
