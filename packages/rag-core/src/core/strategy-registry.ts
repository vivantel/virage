import type { ChunkStrategy } from "../interfaces/chunker.js";
import { ConfigError } from "./errors.js";

export type BuiltinStrategyName =
  | "markdownHeaders"
  | "token"
  | "wholeFile"
  | "semantic";

export const BUILTIN_STRATEGY_NAMES: BuiltinStrategyName[] = [
  "markdownHeaders",
  "token",
  "wholeFile",
  "semantic",
];

export interface StrategyOptions {
  maxTokens?: number;
  overlap?: number;
  [key: string]: unknown;
}

/**
 * Resolves a strategy name string to a ChunkStrategy instance.
 * Tries @vivantel/rag-strategies first, falls back to the re-exports in @vivantel/rag-core.
 */
export async function resolveStrategy(
  name: BuiltinStrategyName | string,
  options?: StrategyOptions,
): Promise<ChunkStrategy> {
  type StrategyModule = {
    markdownHeadersStrategy?: (opts?: StrategyOptions) => ChunkStrategy;
    tokenStrategy?: (opts?: StrategyOptions) => ChunkStrategy;
    wholeFileStrategy?: (opts?: StrategyOptions) => ChunkStrategy;
    semanticStrategy?: (opts?: StrategyOptions) => ChunkStrategy;
  };

  let mod: StrategyModule | null = null;

  // Prefer the dedicated package
  try {
    mod = (await import("@vivantel/rag-strategies")) as StrategyModule;
  } catch {
    // Fall back to re-exports from core
    try {
      mod = (await import("../strategies/chunk/index.js")) as StrategyModule;
    } catch {
      // intentionally empty
    }
  }

  if (!mod) {
    throw new ConfigError(
      `Cannot load chunking strategies. Install @vivantel/rag-strategies: npm install @vivantel/rag-strategies`,
    );
  }

  switch (name) {
    case "markdownHeaders":
      if (!mod.markdownHeadersStrategy) break;
      return mod.markdownHeadersStrategy(options);
    case "token":
      if (!mod.tokenStrategy) break;
      return mod.tokenStrategy(options);
    case "wholeFile":
      if (!mod.wholeFileStrategy) break;
      return mod.wholeFileStrategy(options);
    case "semantic":
      if (!mod.semanticStrategy) break;
      return mod.semanticStrategy(options);
    default:
      throw new ConfigError(
        `Unknown strategy name: "${name}". Valid values: ${BUILTIN_STRATEGY_NAMES.join(", ")}`,
        {
          suggestion: `Use one of: ${BUILTIN_STRATEGY_NAMES.join(", ")}`,
        },
      );
  }

  throw new ConfigError(
    `Strategy "${name}" is not available in the loaded strategies package`,
  );
}
