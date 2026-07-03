export {
  TransformersEmbedder,
  type TransformersEmbedderOptions,
  type QuantizationOptions,
} from "./embedder.js";
export { benchmarkEmbedder, type BenchmarkResult } from "./benchmark.js";

import { z } from "zod";
import type { EmbeddingProvider } from "@vivantel/virage-core";
import {
  TransformersEmbedder,
  type TransformersEmbedderOptions,
} from "./embedder.js";

export const optionsSchema = z.object({
  model: z.string().min(1).describe("HuggingFace model name or local path"),
  dimensions: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Output vector dimensions"),
  device: z.enum(["cpu", "webgpu", "cuda"]).optional().default("cpu"),
  cacheDir: z
    .string()
    .optional()
    .describe("Directory to cache downloaded models"),
});
export type PluginOptions = z.infer<typeof optionsSchema>;

/** Factory used by the JSON config loader. */
export function createEmbedder(
  config: Record<string, unknown>,
): EmbeddingProvider {
  const model = config.model;
  if (typeof model !== "string" || !model) {
    throw new Error(
      '@vivantel/virage-embedder-transformers: config.model is required (e.g. "Xenova/all-MiniLM-L6-v2")',
    );
  }

  const opts: TransformersEmbedderOptions = {
    model,
    dimensions:
      typeof config.dimensions === "number" ? config.dimensions : undefined,
    device: (["webgpu", "cuda"] as const).includes(
      config.device as "webgpu" | "cuda",
    )
      ? (config.device as "webgpu" | "cuda")
      : "cpu",
    cacheDir: typeof config.cacheDir === "string" ? config.cacheDir : undefined,
  };

  return new TransformersEmbedder(opts);
}
