/**
 * @vivantel/rag-strategies
 *
 * Built-in chunking strategies, re-exported from @vivantel/rag-core.
 * Install this package to get a lighter import path for strategies:
 *
 * ```ts
 * // v2+: preferred
 * import { tokenStrategy } from '@vivantel/rag-strategies';
 *
 * // v1.x / legacy (still works, deprecated in @vivantel/rag-core)
 * import { tokenStrategy } from '@vivantel/rag-core';
 * ```
 */
export {
  tokenStrategy,
  markdownHeadersStrategy,
  semanticStrategy,
  wholeFileStrategy,
} from "@vivantel/rag-core";

export type { TokenStrategyOptions } from "@vivantel/rag-core";
