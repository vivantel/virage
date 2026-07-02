export { OnnxEmbedder } from "./embedder.js";
export type { OnnxEmbedderOptions } from "./types.js";

import type { EmbeddingProvider } from "@vivantel/virage-core";
import { OnnxEmbedder } from "./embedder.js";
import type { OnnxEmbedderOptions } from "./types.js";

/** Factory used by the JSON config loader. */
export function createEmbedder(
  config: Record<string, unknown>,
): EmbeddingProvider {
  const model = config["model"];
  if (typeof model !== "string" || !model) {
    throw new Error(
      "@vivantel/virage-embedder-onnx: config.model is required (local directory or HuggingFace model ID)",
    );
  }
  const dimensions = config["dimensions"];
  if (typeof dimensions !== "number" || dimensions <= 0) {
    throw new Error(
      "@vivantel/virage-embedder-onnx: config.dimensions is required (must be a positive number)",
    );
  }

  const opts: OnnxEmbedderOptions = {
    model,
    dimensions,
    tokenizerPath:
      typeof config["tokenizerPath"] === "string"
        ? config["tokenizerPath"]
        : undefined,
    executionProvider:
      typeof config["executionProvider"] === "string"
        ? (config[
            "executionProvider"
          ] as OnnxEmbedderOptions["executionProvider"])
        : undefined,
    deviceId:
      typeof config["deviceId"] === "number" ? config["deviceId"] : undefined,
    numThreads:
      typeof config["numThreads"] === "number"
        ? config["numThreads"]
        : undefined,
    graphOptimizationLevel:
      typeof config["graphOptimizationLevel"] === "number"
        ? (config[
            "graphOptimizationLevel"
          ] as OnnxEmbedderOptions["graphOptimizationLevel"])
        : undefined,
    pooling:
      typeof config["pooling"] === "string"
        ? (config["pooling"] as OnnxEmbedderOptions["pooling"])
        : undefined,
    normalize:
      typeof config["normalize"] === "boolean"
        ? config["normalize"]
        : undefined,
    maxSequenceLength:
      typeof config["maxSequenceLength"] === "number"
        ? config["maxSequenceLength"]
        : undefined,
    cacheDir:
      typeof config["cacheDir"] === "string" ? config["cacheDir"] : undefined,
  };

  return new OnnxEmbedder(opts);
}
