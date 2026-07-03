export { LlmReranker } from "./reranker.js";
export type { LlmRerankerOptions } from "./reranker.js";

import { z } from "zod";
import type { Reranker } from "@vivantel/virage-core";
import { LlmReranker, type LlmRerankerOptions } from "./reranker.js";

export const optionsSchema = z.object({
  model: z.string().optional().describe("LLM model name for reranking"),
  apiKey: z
    .string()
    .optional()
    .describe("API key (defaults to OPENAI_API_KEY env var)"),
  baseURL: z.string().optional().describe("Custom API base URL"),
  topK: z.number().int().positive().optional(),
});
export type PluginOptions = z.infer<typeof optionsSchema>;

export function createReranker(config: Record<string, unknown>): Reranker {
  return new LlmReranker(config as LlmRerankerOptions);
}
