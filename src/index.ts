// Interfaces
export * from "./interfaces/index.js";

// Errors
export {
  RagError,
  ConfigError,
  ChunkError,
  EmbedError,
  UploadError,
} from "./core/errors.js";

// Core
export { GitTracker } from "./core/git-tracker.js";
export { ChunkProcessor } from "./core/chunk-processor.js";
export { EmbedderProcessor } from "./core/embedder.js";
export { Uploader } from "./core/uploader.js";
export { Orchestrator, RAGPipelineConfig } from "./core/orchestrator.js";
export {
  computeContentHash,
  sleep,
  batchArray,
  extractFileName,
  extractDirectory,
  withRetry,
  withConcurrency,
} from "./core/utils.js";
export type { RetryOptions } from "./core/utils.js";

// Plugin ecosystem
export { discoverPlugins, RagPlugin } from "./core/plugin-discovery.js";

/**
 * Chunking strategies.
 *
 * @deprecated Import from `@vivantel/rag-strategies` instead:
 * ```ts
 * import { tokenStrategy } from '@vivantel/rag-strategies';
 * ```
 * Direct exports from `@vivantel/rag-core` will be removed in v3.0.
 */
export {
  tokenStrategy,
  markdownHeadersStrategy,
  semanticStrategy,
  wholeFileStrategy,
} from "./strategies/chunk/index.js";
export type { TokenStrategyOptions } from "./strategies/chunk/token.js";

// Helpers
export { createChunker } from "./helpers/create-chunker.js";

// Config loader
export { loadConfig } from "./config-loader.js";
