export { CrossEncoderReranker } from "./reranker.js";
export type { CrossEncoderRerankerOptions } from "./reranker.js";

import { z } from "zod";
import type { Reranker } from "@vivantel/virage-core";
import {
  CrossEncoderReranker,
  type CrossEncoderRerankerOptions,
} from "./reranker.js";

export const optionsSchema = z.object({
  model: z.string().optional().describe("Cross-encoder model name"),
  topK: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max results to return after reranking"),
  cacheDir: z.string().optional(),
  device: z.enum(["cpu", "cuda", "webgpu"]).optional().default("cpu"),
});
export type PluginOptions = z.infer<typeof optionsSchema>;

export function createReranker(config: Record<string, unknown>): Reranker {
  return new CrossEncoderReranker(config as CrossEncoderRerankerOptions);
}
