import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import { RAGPipelineConfig } from "./core/orchestrator.js";
import type { ChunkerEntry } from "./interfaces/chunker.js";
import { ConfigError } from "./core/errors.js";
import { importPackage } from "./core/module-import.js";
import type { TelemetryConfig } from "./telemetry/types.js";
import type { QualityConfig } from "./interfaces/quality.js";
import { expandEnvVars } from "./core/env-expand.js";
import type { FileChunker } from "./interfaces/chunker.js";
import type { EmbeddingProvider } from "./interfaces/embedder.js";
import type { VectorStore } from "./interfaces/vector-store.js";
import type { Reranker } from "./interfaces/reranker.js";
import type { SourceRepository } from "./interfaces/source-repository.js";
import type { Logger } from "./interfaces/logger.js";

// ─── JSON config types ────────────────────────────────────────────────────────

interface JsonLabelRule {
  /** Minimatch glob pattern (relative to source root). */
  match: string;
  /** Labels to add when the pattern matches. */
  add: string[];
}

interface JsonChunkingFilter {
  /** Global ignore patterns applied before routing files to any chunker. */
  ignore?: string[];
  /** Global label rules applied to every file's label set. */
  labels?: JsonLabelRule[];
}

interface JsonChunkerConfig {
  /** npm package name for the chunker plugin (e.g. "@vivantel/virage-chunker-ce-md") */
  package: string;
  /** Semver version range (informational; used for generator ID traceability). */
  version?: string;
  /** Glob patterns: if set, only matching files are sent to this chunker. */
  include?: string[];
  /** Glob patterns: files matching any of these are skipped for this chunker. */
  ignore?: string[];
  /** Per-chunker label rules — merged with global rules at index time. */
  labels?: JsonLabelRule[];
  /** Options forwarded to createChunker(). */
  options?: Record<string, unknown>;
}

interface JsonChunkingConfig {
  exclude?: string[];
  /** Global filter: path ignores and label rules applied before any chunker runs. */
  filter?: JsonChunkingFilter;
  chunkers: JsonChunkerConfig[];
}

interface JsonProviderConfig {
  package: string;
  config?: Record<string, unknown>;
}

interface JsonSearchConfig {
  hybrid?: boolean;
  hybridAlpha?: number;
  reranker?: JsonProviderConfig;
  rerankOversample?: number;
}

interface JsonAgentConfig {
  package: string;
  options?: Record<string, unknown>;
}

interface JsonRagConfig {
  chunking: JsonChunkingConfig;
  embedder: JsonProviderConfig;
  vectorStore: JsonProviderConfig;
  source?: JsonProviderConfig;
  agents?: JsonAgentConfig[];
  pluginVersions?: Record<string, string>;
  options?: RAGPipelineConfig["options"];
  telemetry?: TelemetryConfig;
  search?: JsonSearchConfig;
  quality?: QualityConfig;
}

// ─── JSON config loading ──────────────────────────────────────────────────────

function isPackageName(s: string): boolean {
  return s.startsWith("@") || s.includes("/");
}

const KNOWN_AGENT_PACKAGES: Record<string, string> = {
  "claude-code": "@vivantel/virage-agent-claude",
  copilot: "@vivantel/virage-agent-copilot",
  codex: "@vivantel/virage-agent-codex",
  antigravity: "@vivantel/virage-agent-antigravity",
};

function normalizeConfig(raw: Record<string, unknown>): void {
  // Migrate deprecated root-level `agents: string[]` to plugin-spec format.
  if (
    Array.isArray(raw.agents) &&
    raw.agents.some((a) => typeof a === "string")
  ) {
    raw.agents = (raw.agents as unknown[]).map((a) =>
      typeof a === "string" ? { package: KNOWN_AGENT_PACKAGES[a] ?? a } : a,
    );
  }
}

function validateJsonConfig(raw: unknown): asserts raw is JsonRagConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError("virage.config.json must be a JSON object");
  }
  const c = raw as Record<string, unknown>;

  if (Array.isArray(c.chunkers)) {
    throw new ConfigError(
      'Root-level "chunkers" is no longer supported — nest it under "chunking.chunkers".',
    );
  }

  if (
    !c.chunking ||
    typeof c.chunking !== "object" ||
    Array.isArray(c.chunking)
  ) {
    throw new ConfigError(
      '"chunking" must be an object with a "chunkers" array in virage.config.json',
    );
  }
  const chunking = c.chunking as Record<string, unknown>;

  if (!Array.isArray(chunking.chunkers) || chunking.chunkers.length === 0) {
    throw new ConfigError(
      '"chunking.chunkers" must be a non-empty array in virage.config.json',
    );
  }
  if (chunking.exclude !== undefined && !Array.isArray(chunking.exclude)) {
    throw new ConfigError(
      '"chunking.exclude" must be an array of glob strings',
    );
  }
  if (Array.isArray(chunking.exclude)) {
    for (let i = 0; i < chunking.exclude.length; i++) {
      if (typeof chunking.exclude[i] !== "string") {
        throw new ConfigError(`chunking.exclude[${i}] must be a string`);
      }
    }
  }
  for (let i = 0; i < (chunking.chunkers as unknown[]).length; i++) {
    const ch = (chunking.chunkers as unknown[])[i] as Record<string, unknown>;
    if (typeof ch.strategy === "string" || Array.isArray(ch.patterns)) {
      throw new ConfigError(
        `chunking.chunkers[${i}] uses the old "strategy"/"patterns" format (deprecated in ADR-038). ` +
          `Replace with "package" and "options". See docs/decisions/ADR-038-package-based-chunker-config.md`,
      );
    }
    if (typeof ch.package !== "string") {
      throw new ConfigError(
        `chunking.chunkers[${i}].package must be a package name string (e.g. "@vivantel/virage-chunker-ce-md")`,
      );
    }
    if (!isPackageName(ch.package as string)) {
      throw new ConfigError(
        `chunking.chunkers[${i}].package "${ch.package}" is not a valid package name.`,
      );
    }
    for (const field of ["include", "ignore"] as const) {
      if (ch[field] !== undefined) {
        if (!Array.isArray(ch[field])) {
          throw new ConfigError(
            `chunking.chunkers[${i}].${field} must be an array of glob strings`,
          );
        }
        for (let j = 0; j < (ch[field] as unknown[]).length; j++) {
          if (typeof (ch[field] as unknown[])[j] !== "string") {
            throw new ConfigError(
              `chunking.chunkers[${i}].${field}[${j}] must be a string`,
            );
          }
        }
      }
    }
  }

  if (!c.embedder || typeof c.embedder !== "object") {
    throw new ConfigError('"embedder" is required in virage.config.json');
  }
  if (typeof (c.embedder as Record<string, unknown>).package !== "string") {
    throw new ConfigError(
      '"embedder.package" must be a string (npm package name)',
    );
  }

  if (!c.vectorStore || typeof c.vectorStore !== "object") {
    throw new ConfigError('"vectorStore" is required in virage.config.json');
  }
  if (typeof (c.vectorStore as Record<string, unknown>).package !== "string") {
    throw new ConfigError(
      '"vectorStore.package" must be a string (npm package name)',
    );
  }
}

async function resolveProvider<T>(
  spec: JsonProviderConfig,
  factoryName:
    | "createEmbedder"
    | "createVectorStore"
    | "createReranker"
    | "createSourceRepository",
): Promise<T> {
  const expanded = expandEnvVars(spec.config ?? {}) as Record<string, unknown>;

  let mod: Record<string, unknown>;
  try {
    mod = (await importPackage(spec.package)) as Record<string, unknown>;
  } catch (err) {
    const isNotFound =
      err instanceof Error &&
      (err.message.includes("Cannot find module") ||
        err.message.includes("Cannot find package") ||
        (err as { code?: string }).code === "ERR_MODULE_NOT_FOUND");
    throw new ConfigError(`Cannot load provider package "${spec.package}"`, {
      suggestion: isNotFound
        ? `Install it first: npm install ${spec.package}`
        : undefined,
      cause: err,
    });
  }

  const factory = mod[factoryName];
  if (typeof factory !== "function") {
    throw new ConfigError(
      `Package "${spec.package}" does not export a ${factoryName}() function`,
      {
        suggestion: `Ensure the package exports: export function ${factoryName}(config) { ... }`,
      },
    );
  }

  return (factory as (config: Record<string, unknown>) => T)(expanded);
}

async function loadJsonConfig(
  configPath: string,
  logger?: Logger,
): Promise<RAGPipelineConfig> {
  let raw: unknown;
  try {
    const content = await readFile(configPath, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    throw new ConfigError(`Cannot read JSON config: ${configPath}`, {
      cause: err,
    });
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    normalizeConfig(raw as Record<string, unknown>);
  }
  validateJsonConfig(raw);
  const jsonConfig = raw as JsonRagConfig;

  const excludePatterns = jsonConfig.chunking.exclude ?? [];

  const chunkers: ChunkerEntry[] = await Promise.all(
    jsonConfig.chunking.chunkers.map(async (ch) => {
      let pkgMod: Record<string, unknown>;
      try {
        pkgMod = (await importPackage(ch.package)) as Record<string, unknown>;
      } catch (err) {
        const isNotFound =
          err instanceof Error &&
          (err.message.includes("Cannot find module") ||
            err.message.includes("Cannot find package") ||
            (err as { code?: string }).code === "ERR_MODULE_NOT_FOUND");
        throw new ConfigError(`Cannot load chunker package "${ch.package}"`, {
          suggestion: isNotFound
            ? `Install it first: npm install ${ch.package}`
            : undefined,
          cause: err,
        });
      }
      const factory = pkgMod["createChunker"];
      if (typeof factory !== "function") {
        throw new ConfigError(
          `Package "${ch.package}" does not export a createChunker() function`,
        );
      }
      const chunker = (
        factory as (opts?: Record<string, unknown>) => FileChunker
      )(ch.options ?? {});
      return {
        chunker,
        include: ch.include,
        ignore: ch.ignore,
        labels: ch.labels,
      };
    }),
  );

  const embedder = await resolveProvider<EmbeddingProvider>(
    jsonConfig.embedder,
    "createEmbedder",
  );

  // Propagate embedder dimensions to the vectorStore so the schema always
  // matches without requiring users to repeat the value in two config blocks.
  // An explicit vectorStore.config.dimensions still takes precedence.
  const vectorStoreSpec: JsonProviderConfig = {
    ...jsonConfig.vectorStore,
    config: {
      dimensions: embedder.dimensions,
      ...jsonConfig.vectorStore.config,
    },
  };

  const vectorStore = await resolveProvider<VectorStore>(
    vectorStoreSpec,
    "createVectorStore",
  );

  // Pass the logger to plugins via setLogger() if they support it (duck-type check)
  if (logger) {
    for (const instance of [embedder, vectorStore]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inst = instance as any;
      if (typeof inst.setLogger === "function") {
        inst.setLogger(logger);
      }
    }
  }

  let reranker: Reranker | undefined;
  if (jsonConfig.search?.reranker) {
    reranker = await resolveProvider<Reranker>(
      jsonConfig.search.reranker,
      "createReranker",
    );
  }

  let sourceRepository: SourceRepository | undefined;
  if (jsonConfig.source) {
    sourceRepository = await resolveProvider<SourceRepository>(
      jsonConfig.source,
      "createSourceRepository",
    );
  }

  const globalLabelRules = jsonConfig.chunking.filter?.labels;
  const globalIgnore = jsonConfig.chunking.filter?.ignore ?? [];
  const mergedExclude = [...excludePatterns, ...globalIgnore];

  return {
    chunkers,
    embedder,
    vectorStore,
    sourceRepository,
    excludePatterns: mergedExclude,
    globalLabelRules,
    telemetry: jsonConfig.telemetry,
    options: jsonConfig.options,
    search: {
      hybrid: jsonConfig.search?.hybrid,
      hybridAlpha: jsonConfig.search?.hybridAlpha,
      reranker,
      rerankOversample: jsonConfig.search?.rerankOversample,
    },
    quality: jsonConfig.quality,
  };
}

// ─── Auto-detection ───────────────────────────────────────────────────────────

/** Returns the default config path (virage.config.json). */
export function autoDetectConfig(): string {
  if (existsSync(resolve(process.cwd(), "virage.config.json"))) {
    return "./virage.config.json";
  }
  return "./virage.config.json";
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function loadConfig(
  configPath: string,
  logger?: Logger,
): Promise<RAGPipelineConfig> {
  if (configPath.endsWith(".ts")) {
    throw new ConfigError(
      "TypeScript config files (virage.config.ts) are no longer supported.",
      {
        suggestion:
          "Run `virage init` to generate a virage.config.json, or rename your config and convert it to JSON format.",
      },
    );
  }

  return loadJsonConfig(configPath, logger);
}
