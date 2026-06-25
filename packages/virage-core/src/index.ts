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
export { CliGitSourceRepository } from "./core/cli-git-source-repository.js";
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
export {
  makeDenseText,
  makeSparseText,
  computeDenseTextHash,
} from "./core/chunk-utils.js";
export { rrfMerge } from "./core/rrf.js";
export type { RetryOptions } from "./core/utils.js";

// Plugin ecosystem
export { discoverPlugins, RagPlugin } from "./core/plugin-discovery.js";
export { loadRegistry } from "./plugin-registry.js";
export type { PluginRegistry } from "./plugin-registry.js";

// Storage
export { VirageDb } from "./core/virage-db.js";
export type { SearchQueryRow } from "./core/virage-db.js";

// Defaults and constants
export {
  getVirageDir,
  getGlobalVirageDir,
  defaultVirageDb,
  IGNORED_DIRS,
  DEFAULT_EXCLUDE_PATTERNS,
} from "./core/virage-defaults.js";

// Embeddings I/O
export {
  readEmbeddingsFile,
  writeEmbeddingsFile,
} from "./core/embeddings-io.js";
export type { EmbeddingsReadResult } from "./core/embeddings-io.js";

// Config loader
export { loadConfig, autoDetectConfig } from "./config-loader.js";

// Telemetry
export type {
  TelemetryConfig,
  SessionMetadata,
  FeedbackPayload,
  SessionSummaryPayload,
} from "./telemetry/index.js";
export {
  DEFAULT_TELEMETRY_CONFIG,
  COMMUNITY_TELEMETRY_ENDPOINT,
  MISSING_CATEGORY_VALUES,
  TelemetrySession,
  TelemetryFlusher,
  TelemetryManager,
  resultCountBucket,
  normalizeMissingCategory,
} from "./telemetry/index.js";
export type { PipelineRunData } from "./core/telemetry.js";

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
export { downloadAndExtract, downloadAndExtractTo } from "./eval/archive.js";
export { ensurePluginsInstalled } from "./eval/plugin-install.js";
export { runSuite } from "./eval/suite-runner.js";
export type {
  SuiteVariantResult,
  SuiteResult,
  SuiteRunOptions,
} from "./eval/suite-runner.js";
export { loadEvalDataset, saveEvalDataset } from "./eval/dataset-io.js";
export {
  EcosystemEvaluator,
  printEcosystemEvalResult,
} from "./eval/ecosystem-eval.js";
export type {
  EcosystemEvalDataset,
  EcosystemEvalResult,
} from "./eval/ecosystem-eval.js";
export { SkillRoutingEvaluator } from "./eval/skill-routing-eval.js";
export type {
  SkillRoutingQuery,
  SkillRoutingEvalResult,
} from "./eval/skill-routing-eval.js";
