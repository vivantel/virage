export { LlmReranker } from "./reranker.js";
export type { LlmRerankerOptions } from "./reranker.js";

import type { Reranker } from "@vivantel/virage-core";
import { LlmReranker, type LlmRerankerOptions } from "./reranker.js";

export function createReranker(config: Record<string, unknown>): Reranker {
  return new LlmReranker(config as LlmRerankerOptions);
}
