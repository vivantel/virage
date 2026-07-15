// See docs/ai/guardrails/config-schema.md and ADR-041/043/046 before modifying this file.
import { z } from "zod";

// ─── Building blocks ──────────────────────────────────────────────────────────

const ZodTemplateValue = z.union([
  z.string(),
  z.object({ file: z.string().min(1) }),
]);

const ZodChunkerTemplate = z.object({
  denseText: ZodTemplateValue.optional(),
  sparseText: ZodTemplateValue.optional(),
});

const ZodTagRule = z.object({
  match: z.string().min(1),
  add: z.array(z.string()),
});

// Base options shared by both ref variants
const ZodPluginRefBase = z.object({
  options: z.record(z.string(), z.unknown()).optional(),
});

// { "package": "@vivantel/..." } — npm package ref (v1 + v2)
const ZodPackageRef = ZodPluginRefBase.extend({
  package: z.string().min(1, "package name is required"),
  packageVersion: z.string().optional(),
});

// { "builtin": "lang" } — named builtin ref (v2)
const ZodBuiltinRef = ZodPluginRefBase.extend({
  builtin: z.string().min(1, "builtin key is required"),
});

const ZodPluginRef = z.union([ZodPackageRef, ZodBuiltinRef]);

// ChunkerConfig extends both variants to add templates
const ZodChunkerConfig = z.union([
  ZodPackageRef.extend({ templates: ZodChunkerTemplate.optional() }),
  ZodBuiltinRef.extend({ templates: ZodChunkerTemplate.optional() }),
]);

// FileSet source can be a named string reference (v2) or an inline PluginRef (v1)
const ZodSourceRef = z.union([z.string().min(1), ZodPluginRef]);

const ZodFileSetConfig = z.object({
  name: z.string().min(1, "fileSet name is required"),
  source: ZodSourceRef.optional(),
  include: z.array(z.string()).optional(),
  ignore: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  tagRules: z.array(ZodTagRule).optional(),
  chunkers: z
    .array(ZodChunkerConfig)
    .min(1, "fileSets[].chunkers must have at least one entry"),
});

const ZodProvidersConfig = z.object({
  embedder: ZodPluginRef,
  queryEmbedder: ZodPluginRef.optional(),
  vectorStore: ZodPluginRef,
  reranker: ZodPluginRef.optional(),
  source: ZodPluginRef.optional(),
});

const ZodSearchConfig = z.object({
  hybrid: z.boolean().optional(),
  hybridAlpha: z.number().min(0).max(1).optional(),
  rerankOversample: z.number().int().positive().optional(),
  minSimilarity: z.number().min(0).max(1).optional(),
});

const ZodPipelineOptions = z.object({
  embeddingsFile: z
    .string()
    .describe(
      "Path to a pre-computed embeddings JSON file (skip embedding step)",
    )
    .optional(),
  force: z
    .boolean()
    .describe(
      "Re-embed all chunks even if they are already in the vector store",
    )
    .optional(),
  skipUpload: z
    .boolean()
    .describe("Embed but do not upload to the vector store")
    .optional(),
  dryRun: z
    .boolean()
    .describe("Show what would change without writing anything")
    .optional(),
  rateLimitMs: z
    .number()
    .nonnegative()
    .describe("Minimum milliseconds between embedding API calls (default: 0)")
    .optional(),
  batchSize: z
    .number()
    .int()
    .positive()
    .describe("Max chunks per embedding API request")
    .optional(),
  maxBatchChars: z
    .number()
    .int()
    .positive()
    .describe("Max total characters per embedding API request")
    .optional(),
  concurrency: z
    .number()
    .int()
    .positive()
    .describe("Number of files processed in parallel")
    .optional(),
  chunkConcurrency: z
    .number()
    .int()
    .positive()
    .describe("Number of chunking workers per file")
    .optional(),
  minEmbeddingBatchSize: z
    .number()
    .int()
    .positive()
    .describe(
      "Minimum chunks to accumulate before sending an embedding request (default: 10)",
    )
    .optional(),
  minUploadingBatchSize: z
    .number()
    .int()
    .positive()
    .describe(
      "Minimum chunks to accumulate before uploading to the vector store (default: 20)",
    )
    .optional(),
  maxPendingFiles: z
    .number()
    .int()
    .positive()
    .describe(
      "Backpressure limit: max files queued for chunking before pausing file reads",
    )
    .optional(),
  noBanner: z.boolean().describe("Suppress the startup banner").optional(),
});

const ZodAgentRef = ZodPluginRef;

// ─── Top-level config ─────────────────────────────────────────────────────────

export const VIRAGE_CONFIG_SCHEMA_VERSION = "2";

export const ZodVirageConfig = z.object({
  $schema: z.string().optional(),
  version: z
    .string()
    .describe(
      'Config schema version. Use "2" for named sources and builtin keys (IR-020).',
    )
    .optional(),
  // v2: named source provider map. Absent in v1 configs (still valid without it).
  sources: z.record(z.string().min(1), ZodPluginRef).optional(),
  installScope: z
    .enum(["local", "global"])
    .describe(
      "Where plugins and embedding/reranker model files are installed and loaded from. Set by 'virage init'.",
    )
    .optional(),
  providers: ZodProvidersConfig,
  fileSets: z
    .array(ZodFileSetConfig)
    .min(1, "fileSets must have at least one entry"),
  ignore: z.array(z.string()).optional(),
  search: ZodSearchConfig.optional(),
  agents: z.array(ZodAgentRef).optional(),
  pipeline: ZodPipelineOptions.optional(),
  telemetry: z.record(z.string(), z.unknown()).optional(),
  quality: z.record(z.string(), z.unknown()).optional(),
});

// ─── Exported types ───────────────────────────────────────────────────────────

export type VirageConfigJson = z.infer<typeof ZodVirageConfig>;
export type PluginRef = z.infer<typeof ZodPluginRef>;
export type ChunkerConfig = z.infer<typeof ZodChunkerConfig>;
export type FileSetConfig = z.infer<typeof ZodFileSetConfig>;
export type ProvidersConfig = z.infer<typeof ZodProvidersConfig>;
export type SourceRef = z.infer<typeof ZodSourceRef>;
export type TagRule = z.infer<typeof ZodTagRule>;
export type TemplateValue = z.infer<typeof ZodTemplateValue>;
export type ChunkerTemplate = z.infer<typeof ZodChunkerTemplate>;
