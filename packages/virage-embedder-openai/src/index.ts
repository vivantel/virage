export {
  OpenAICompatibleEmbedder,
  type OpenAICompatibleEmbedderOptions,
} from "./embedder.js";
export {
  computeEmbeddingMetrics,
  cosineSimilarity,
  computeIntrinsicDimension,
  computeAvgCosineSimRandomPairs,
  detectOutliers,
} from "./embedding-metrics.js";
export { OpenAIJudge, type OpenAIJudgeOptions } from "./judge.js";
export { SemanticCache, type SemanticCacheConfig } from "./semantic-cache.js";
export {
  createAzureOpenAIEmbedder,
  createOllamaEmbedder,
  type AzureOpenAIPresetOptions,
  type OllamaPresetOptions,
} from "./presets.js";

import type { EmbeddingProvider } from "@vivantel/virage-core";
import {
  OpenAICompatibleEmbedder,
  type OpenAICompatibleEmbedderOptions,
} from "./embedder.js";

/** Factory used by the JSON config loader. */
export function createEmbedder(
  config: Record<string, unknown>,
): EmbeddingProvider {
  const apiKey = config.apiKey;
  if (typeof apiKey !== "string" || !apiKey) {
    throw new Error(
      "@vivantel/virage-embedder-openai: config.apiKey is required",
    );
  }
  const model = config.model;
  if (typeof model !== "string" || !model) {
    throw new Error(
      "@vivantel/virage-embedder-openai: config.model is required",
    );
  }

  const opts: OpenAICompatibleEmbedderOptions = {
    apiKey,
    model,
    dimensions:
      typeof config.dimensions === "number" ? config.dimensions : undefined,
    baseURL: typeof config.baseURL === "string" ? config.baseURL : undefined,
    organizationId:
      typeof config.organizationId === "string"
        ? config.organizationId
        : undefined,
    maxRetries:
      typeof config.maxRetries === "number" ? config.maxRetries : undefined,
  };

  return new OpenAICompatibleEmbedder(opts);
}
