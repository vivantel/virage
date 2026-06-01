export {
  TransformersEmbedder,
  type TransformersEmbedderOptions,
  type QuantizationOptions,
} from "./embedder.js";
export { benchmarkEmbedder, type BenchmarkResult } from "./benchmark.js";

import type { EmbeddingProvider } from "@vivantel/rag-core";
import {
  TransformersEmbedder,
  type TransformersEmbedderOptions,
} from "./embedder.js";

/** Factory used by the JSON config loader. */
export function createEmbedder(
  config: Record<string, unknown>,
): EmbeddingProvider {
  const model = config.model;
  if (typeof model !== "string" || !model) {
    throw new Error(
      '@vivantel/rag-embedder-transformers: config.model is required (e.g. "Xenova/all-MiniLM-L6-v2")',
    );
  }

  const opts: TransformersEmbedderOptions = {
    model,
    dimensions:
      typeof config.dimensions === "number" ? config.dimensions : undefined,
    device: config.device === "webgpu" ? "webgpu" : "cpu",
    cacheDir: typeof config.cacheDir === "string" ? config.cacheDir : undefined,
  };

  return new TransformersEmbedder(opts);
}
