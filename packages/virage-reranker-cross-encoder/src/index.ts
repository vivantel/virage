export { CrossEncoderReranker } from "./reranker.js";
export type { CrossEncoderRerankerOptions } from "./reranker.js";

import type { Reranker } from "@vivantel/virage-core";
import {
  CrossEncoderReranker,
  type CrossEncoderRerankerOptions,
} from "./reranker.js";

export function createReranker(config: Record<string, unknown>): Reranker {
  return new CrossEncoderReranker(config as CrossEncoderRerankerOptions);
}
