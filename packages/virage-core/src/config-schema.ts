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

const ZodPluginRef = z.object({
  package: z.string().min(1, "package name is required"),
  packageVersion: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

const ZodChunkerConfig = ZodPluginRef.extend({
  templates: ZodChunkerTemplate.optional(),
});

const ZodFileSetConfig = z.object({
  name: z.string().min(1, "fileSet name is required"),
  source: ZodPluginRef.optional(),
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
  vectorStore: ZodPluginRef,
  reranker: ZodPluginRef.optional(),
  source: ZodPluginRef.optional(),
});

const ZodSearchConfig = z.object({
  hybrid: z.boolean().optional(),
  hybridAlpha: z.number().min(0).max(1).optional(),
  rerankOversample: z.number().int().positive().optional(),
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

export const ZodVirageConfig = z.object({
  $schema: z.string().optional(),
  version: z
    .string()
    .describe(
      "Config schema version (semver). Bump when making breaking changes to this file.",
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
export type TagRule = z.infer<typeof ZodTagRule>;
export type TemplateValue = z.infer<typeof ZodTemplateValue>;
export type ChunkerTemplate = z.infer<typeof ZodChunkerTemplate>;
