/**
 * @vivantel/virage-strategies
 *
 * Built-in chunking strategies, re-exported from @vivantel/virage-core.
 * Install this package to get a lighter import path for strategies:
 *
 * ```ts
 * // v2+: preferred
 * import { tokenStrategy } from '@vivantel/virage-strategies';
 *
 * // v1.x / legacy (still works, deprecated in @vivantel/virage-core)
 * import { tokenStrategy } from '@vivantel/virage-core';
 * ```
 */
export {
  tokenStrategy,
  markdownHeadersStrategy,
  semanticStrategy,
  wholeFileStrategy,
} from "@vivantel/virage-core";

export type { TokenStrategyOptions } from "@vivantel/virage-core";
