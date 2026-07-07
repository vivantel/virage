import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { ZodVirageConfig } from "./config-schema.js";
import type { VirageConfigJson, PluginRef } from "./config-schema.js";
import { RAGPipelineConfig } from "./core/orchestrator.js";
import type { ChunkerEntry, TagRule } from "./interfaces/chunker.js";
import { ConfigError } from "./core/errors.js";
import { importPackage } from "./core/module-import.js";
import type { TelemetryConfig } from "./telemetry/types.js";
import type { FileChunker } from "./interfaces/chunker.js";
import type { EmbeddingProvider } from "./interfaces/embedder.js";
import type { VectorStore } from "./interfaces/vector-store.js";
import type { Reranker } from "./interfaces/reranker.js";
import type { SourceRepository } from "./interfaces/source-repository.js";
import type { Logger } from "./interfaces/logger.js";
import { expandEnvVars } from "./core/env-expand.js";

// ─── Plugin loading ───────────────────────────────────────────────────────────

async function loadPlugin(pkgName: string): Promise<Record<string, unknown>> {
  try {
    return (await importPackage(pkgName)) as Record<string, unknown>;
  } catch (err) {
    const isNotFound =
      err instanceof Error &&
      (err.message.includes("Cannot find module") ||
        err.message.includes("Cannot find package") ||
        (err as { code?: string }).code === "ERR_MODULE_NOT_FOUND");
    throw new ConfigError(`Cannot load plugin "${pkgName}"`, {
      suggestion: isNotFound
        ? `Install it first: npm install ${pkgName}`
        : undefined,
      cause: err,
    });
  }
}

function validatePluginOptions(
  mod: Record<string, unknown>,
  pkgName: string,
  options: Record<string, unknown>,
): void {
  if (
    typeof (mod["optionsSchema"] as Record<string, unknown> | undefined)?.[
      "parse"
    ] === "function"
  ) {
    try {
      (mod["optionsSchema"] as { parse: (v: unknown) => unknown }).parse(
        options,
      );
    } catch (err) {
      throw new ConfigError(
        `Invalid options for plugin "${pkgName}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

async function resolveProvider<T>(
  spec: PluginRef,
  factoryName:
    | "createEmbedder"
    | "createVectorStore"
    | "createReranker"
    | "createSourceRepository",
): Promise<T> {
  const mod = await loadPlugin(spec.package);
  const expanded = expandEnvVars(spec.options ?? {}) as Record<string, unknown>;
  validatePluginOptions(mod, spec.package, expanded);

  const factory = mod[factoryName];
  if (typeof factory !== "function") {
    throw new ConfigError(
      `Plugin "${spec.package}" does not export ${factoryName}()`,
      {
        suggestion: `Ensure the package exports: export function ${factoryName}(options) { ... }`,
      },
    );
  }
  return (factory as (opts: Record<string, unknown>) => T)(expanded);
}

async function resolveChunker(spec: PluginRef): Promise<FileChunker> {
  const mod = await loadPlugin(spec.package);
  const expanded = expandEnvVars(spec.options ?? {}) as Record<string, unknown>;
  validatePluginOptions(mod, spec.package, expanded);

  const factory = mod["createChunker"];
  if (typeof factory !== "function") {
    throw new ConfigError(
      `Plugin "${spec.package}" does not export createChunker()`,
    );
  }
  return (factory as (opts: Record<string, unknown>) => FileChunker)(expanded);
}

// ─── Config loading ───────────────────────────────────────────────────────────

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

  let config: VirageConfigJson;
  try {
    config = ZodVirageConfig.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Invalid virage config at ${configPath}:\n${detail}`,
      { cause: err },
    );
  }

  // Derive plugin and model base dir from installScope, unless already overridden
  if (config.installScope && !process.env["VIRAGE_DIR"]) {
    process.env["VIRAGE_DIR"] =
      config.installScope === "global"
        ? join(homedir(), ".virage")
        : resolve(dirname(configPath), ".virage");
  }

  // Resolve providers
  const embedder = await resolveProvider<EmbeddingProvider>(
    config.providers.embedder,
    "createEmbedder",
  );

  const queryEmbedder = config.providers.queryEmbedder
    ? await resolveProvider<EmbeddingProvider>(
        config.providers.queryEmbedder,
        "createEmbedder",
      )
    : undefined;

  // Propagate embedder dimensions to the vectorStore unless explicitly set
  const vsRef: PluginRef = {
    ...config.providers.vectorStore,
    options: {
      dimensions: embedder.dimensions,
      ...config.providers.vectorStore.options,
    },
  };
  const vectorStore = await resolveProvider<VectorStore>(
    vsRef,
    "createVectorStore",
  );

  if (logger) {
    for (const instance of [embedder, vectorStore]) {
      const inst = instance as unknown as { setLogger?: (l: Logger) => void };
      inst.setLogger?.(logger);
    }
  }

  let reranker: Reranker | undefined;
  if (config.providers.reranker) {
    reranker = await resolveProvider<Reranker>(
      config.providers.reranker,
      "createReranker",
    );
  }

  let sourceRepository: SourceRepository | undefined;
  if (config.providers.source) {
    sourceRepository = await resolveProvider<SourceRepository>(
      config.providers.source,
      "createSourceRepository",
    );
  }

  // Build flat ChunkerEntry[] from fileSets
  const fileSetEntries: ChunkerEntry[] = [];
  for (const fileSet of config.fileSets) {
    const fileSetSource = fileSet.source;
    if (fileSetSource && !sourceRepository) {
      // Per-fileSet source override — would require routing per-file; log a warning for now
      logger?.warn?.(
        `fileSet "${fileSet.name}" has a source override — per-fileSet source overrides are not yet implemented; using global source.`,
      );
    }

    for (const chunkerSpec of fileSet.chunkers) {
      const chunker = await resolveChunker(chunkerSpec);
      const entry: ChunkerEntry = {
        chunker,
        include: fileSet.include,
        ignore: fileSet.ignore,
        fileSetTags: fileSet.tags ?? [],
        tagRules: (fileSet.tagRules ?? []) as TagRule[],
        chunkerKey: chunkerSpec.package,
        templates: chunkerSpec.templates as ChunkerEntry["templates"],
        fileSetName: fileSet.name,
      };
      fileSetEntries.push(entry);
    }
  }

  return {
    fileSetEntries,
    embedder,
    vectorStore,
    sourceRepository,
    globalIgnore: config.ignore,
    telemetry: config.telemetry as TelemetryConfig | undefined,
    options: config.pipeline,
    search: {
      hybrid: config.search?.hybrid,
      hybridAlpha: config.search?.hybridAlpha,
      reranker,
      rerankOversample: config.search?.rerankOversample,
      queryEmbedder,
      minSimilarity: config.search?.minSimilarity,
    },
    quality: config.quality as RAGPipelineConfig["quality"],
  };
}

// ─── Auto-detection ───────────────────────────────────────────────────────────

/** Returns the default config path, or null if no config file is found. */
export function autoDetectConfig(): string | null {
  const path = resolve(process.cwd(), "virage.config.json");
  return existsSync(path) ? "./virage.config.json" : null;
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
