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

// Providers
/**
 * @deprecated Use `@vivantel/rag-embedder-openai` instead.
 * Will be removed in v3.0.
 */
export { GitHubModelsEmbedder } from "./providers/github-models.js";
export type { GitHubModelsEmbedderOptions } from "./providers/github-models.js";

// Embeddings I/O
export {
  readEmbeddingsFile,
  writeEmbeddingsFile,
} from "./core/embeddings-io.js";
export type { EmbeddingsReadResult } from "./core/embeddings-io.js";

// Config loader
export { loadConfig, autoDetectConfig } from "./config-loader.js";

// Evaluation framework
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
