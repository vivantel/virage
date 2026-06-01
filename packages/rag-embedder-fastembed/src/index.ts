export {
  FastEmbedEmbedder,
  type FastEmbedEmbedderOptions,
} from "./embedder.js";

import type { EmbeddingProvider } from "@vivantel/rag-core";
import {
  FastEmbedEmbedder,
  type FastEmbedEmbedderOptions,
} from "./embedder.js";

/** Factory used by the JSON config loader. */
export function createEmbedder(
  config: Record<string, unknown>,
): EmbeddingProvider {
  const opts: FastEmbedEmbedderOptions = {
    model: typeof config.model === "string" ? config.model : undefined,
    dimensions:
      typeof config.dimensions === "number" ? config.dimensions : undefined,
    cacheDir:
      typeof config.cacheDir === "string" ? config.cacheDir : undefined,
    showDownloadProgress:
      typeof config.showDownloadProgress === "boolean"
        ? config.showDownloadProgress
        : undefined,
  };

  return new FastEmbedEmbedder(opts);
}
