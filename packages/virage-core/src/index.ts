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
  batchBySize,
  extractFileName,
  extractDirectory,
  withRetry,
  withConcurrency,
} from "./core/utils.js";
export type { RetryOptions } from "./core/utils.js";

// Plugin ecosystem
export { discoverPlugins, RagPlugin } from "./core/plugin-discovery.js";
export { loadRegistry } from "./plugin-registry.js";
export type { PluginRegistry } from "./plugin-registry.js";

// Storage
export { EmbeddingsDb } from "./core/embeddings-db.js";

// Defaults and constants
export {
  getVirageDir,
  defaultChunksFile,
  defaultEmbeddingsFile,
  defaultEmbeddingsDb,
  IGNORED_DIRS,
} from "./core/virage-defaults.js";

/**
 * Chunking strategies.
 *
 * @deprecated Import from `@vivantel/virage-strategies` instead:
 * ```ts
 * import { tokenStrategy } from '@vivantel/virage-strategies';
 * ```
 * Direct exports from `@vivantel/virage-core` will be removed in v3.0.
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

// Embeddings I/O
export {
  readEmbeddingsFile,
  writeEmbeddingsFile,
} from "./core/embeddings-io.js";
export type { EmbeddingsReadResult } from "./core/embeddings-io.js";

// Config loader
export { loadConfig, autoDetectConfig } from "./config-loader.js";

// Logger
export { NullLogger } from "./logger/null-logger.js";

// Evaluation framework
export { generateEvalDataset } from "./eval/generator.js";
export { EvalRunner } from "./eval/runner.js";
export { RAGASRunner } from "./eval/ragas.js";
export type { EvalRunResult } from "./eval/runner.js";
export { ExperimentStore, makeRunId } from "./eval/experiment-store.js";
export {
  precisionAtK,
  recallAtK,
  reciprocalRank,
  hitRateAtK,
  aggregateEvalResults,
  computeEvalResult,
} from "./eval/metrics.js";
export { bootstrapPairedTest } from "./eval/statistics.js";
export type { StatTestResult } from "./eval/statistics.js";
export { loadEvalDataset, saveEvalDataset } from "./eval/dataset-io.js";
