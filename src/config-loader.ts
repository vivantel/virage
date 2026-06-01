import { pathToFileURL } from "url";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import { RAGPipelineConfig } from "./core/orchestrator.js";
import { ConfigError } from "./core/errors.js";
import { expandEnvVars } from "./core/env-expand.js";
import {
  resolveStrategy,
  BuiltinStrategyName,
  StrategyOptions,
} from "./core/strategy-registry.js";
import { createChunker } from "./helpers/create-chunker.js";
import type { EmbeddingProvider } from "./interfaces/embedder.js";
import type { VectorStore } from "./interfaces/vector-store.js";

// ─── JSON config types ────────────────────────────────────────────────────────

interface JsonChunkerConfig {
  name?: string;
  patterns: string[];
  strategy: BuiltinStrategyName;
  strategyOptions?: StrategyOptions;
}

interface JsonProviderConfig {
  package: string;
  config?: Record<string, unknown>;
}

interface JsonRagConfig {
  chunkers: JsonChunkerConfig[];
  embedder: JsonProviderConfig;
  vectorStore: JsonProviderConfig;
  options?: RAGPipelineConfig["options"];
}

// ─── TypeScript config validation ────────────────────────────────────────────

function validateConfig(config: unknown): asserts config is RAGPipelineConfig {
  if (!config || typeof config !== "object") {
    throw new ConfigError("Config must be a non-null object", {
      suggestion:
        "Ensure your config file has a default export: `export default { chunkers, embedder, vectorStore }`.",
    });
  }

  const c = config as Record<string, unknown>;

  if (!Array.isArray(c.chunkers) || c.chunkers.length === 0) {
    throw new ConfigError("config.chunkers must be a non-empty array", {
      suggestion:
        "Add at least one chunker using createChunker() or implementing FileChunker.",
    });
  }

  for (let i = 0; i < c.chunkers.length; i++) {
    const chunker = c.chunkers[i] as Record<string, unknown>;
    if (typeof chunker.name !== "string" || !chunker.name) {
      throw new ConfigError(
        `config.chunkers[${i}].name must be a non-empty string`,
      );
    }
    if (!Array.isArray(chunker.patterns) || chunker.patterns.length === 0) {
      throw new ConfigError(
        `config.chunkers[${i}] ("${chunker.name}") must have a non-empty patterns array`,
      );
    }
    if (typeof chunker.chunk !== "function") {
      throw new ConfigError(
        `config.chunkers[${i}] ("${chunker.name}") must implement chunk(filePath, commitHash)`,
      );
    }
  }

  if (!c.embedder || typeof c.embedder !== "object") {
    throw new ConfigError("config.embedder is required", {
      suggestion:
        "Provide an object implementing EmbeddingProvider with at least name, dimensions, and embed().",
    });
  }

  const emb = c.embedder as Record<string, unknown>;
  if (typeof emb.name !== "string") {
    throw new ConfigError("config.embedder.name must be a string");
  }
  if (typeof emb.dimensions !== "number") {
    throw new ConfigError(
      "config.embedder.dimensions must be a number (the vector output size)",
    );
  }
  if (typeof emb.embed !== "function") {
    throw new ConfigError(
      "config.embedder must implement embed(text: string): Promise<number[]>",
    );
  }

  if (!c.vectorStore || typeof c.vectorStore !== "object") {
    throw new ConfigError("config.vectorStore is required", {
      suggestion:
        "Provide an object implementing VectorStore with initialize, upsert, deleteBySourceFile, getCurrentState, and search.",
    });
  }

  const vs = c.vectorStore as Record<string, unknown>;
  const required = [
    "initialize",
    "upsert",
    "deleteBySourceFile",
    "getCurrentState",
    "search",
  ];
  for (const method of required) {
    if (typeof vs[method] !== "function") {
      throw new ConfigError(`config.vectorStore.${method} must be a function`, {
        suggestion: `Implement ${method}() on your VectorStore object.`,
      });
    }
  }
}

// ─── JSON config loading ──────────────────────────────────────────────────────

function validateJsonConfig(raw: unknown): asserts raw is JsonRagConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError("rag.config.json must be a JSON object");
  }
  const c = raw as Record<string, unknown>;

  if (!Array.isArray(c.chunkers) || c.chunkers.length === 0) {
    throw new ConfigError(
      '"chunkers" must be a non-empty array in rag.config.json',
    );
  }
  for (let i = 0; i < c.chunkers.length; i++) {
    const ch = c.chunkers[i] as Record<string, unknown>;
    if (!Array.isArray(ch.patterns) || ch.patterns.length === 0) {
      throw new ConfigError(
        `chunkers[${i}].patterns must be a non-empty array`,
      );
    }
    if (typeof ch.strategy !== "string") {
      throw new ConfigError(`chunkers[${i}].strategy must be a string`);
    }
  }

  if (!c.embedder || typeof c.embedder !== "object") {
    throw new ConfigError('"embedder" is required in rag.config.json');
  }
  if (typeof (c.embedder as Record<string, unknown>).package !== "string") {
    throw new ConfigError(
      '"embedder.package" must be a string (npm package name)',
    );
  }

  if (!c.vectorStore || typeof c.vectorStore !== "object") {
    throw new ConfigError('"vectorStore" is required in rag.config.json');
  }
  if (typeof (c.vectorStore as Record<string, unknown>).package !== "string") {
    throw new ConfigError(
      '"vectorStore.package" must be a string (npm package name)',
    );
  }
}

async function resolveProvider<T>(
  spec: JsonProviderConfig,
  factoryName: "createEmbedder" | "createVectorStore",
): Promise<T> {
  const expanded = expandEnvVars(spec.config ?? {}) as Record<string, unknown>;

  let mod: Record<string, unknown>;
  try {
    mod = (await import(spec.package)) as Record<string, unknown>;
  } catch (err) {
    const isNotFound =
      err instanceof Error && err.message.includes("Cannot find module");
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

async function loadJsonConfig(configPath: string): Promise<RAGPipelineConfig> {
  let raw: unknown;
  try {
    const content = await readFile(configPath, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    throw new ConfigError(`Cannot read JSON config: ${configPath}`, {
      cause: err,
    });
  }

  validateJsonConfig(raw);
  const jsonConfig = raw as JsonRagConfig;

  // Resolve chunkers
  const chunkers = await Promise.all(
    jsonConfig.chunkers.map(async (ch) => {
      const strategy = await resolveStrategy(
        ch.strategy as BuiltinStrategyName,
        ch.strategyOptions,
      );
      const name = ch.name ?? `${ch.strategy}:${ch.patterns[0]}`;
      return createChunker({ name, patterns: ch.patterns, strategy });
    }),
  );

  const embedder = await resolveProvider<EmbeddingProvider>(
    jsonConfig.embedder,
    "createEmbedder",
  );

  const vectorStore = await resolveProvider<VectorStore>(
    jsonConfig.vectorStore,
    "createVectorStore",
  );

  return {
    chunkers,
    embedder,
    vectorStore,
    options: jsonConfig.options,
  };
}

// ─── Auto-detection ───────────────────────────────────────────────────────────

/** Returns the default config path, preferring rag.config.json over rag.config.ts. */
export function autoDetectConfig(): string {
  if (existsSync(resolve(process.cwd(), "rag.config.json"))) {
    return "./rag.config.json";
  }
  return "./rag.config.ts";
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function loadConfig(
  configPath: string,
): Promise<RAGPipelineConfig> {
  if (configPath.endsWith(".json")) {
    return loadJsonConfig(configPath);
  }

  let configModule;
  try {
    const configUrl = pathToFileURL(configPath).href;
    if (configPath.endsWith(".ts")) {
      const { tsImport } = await import("tsx/esm/api");
      configModule = await tsImport(configUrl, import.meta.url);
    } else {
      configModule = await import(configUrl);
    }
  } catch (err) {
    throw new ConfigError(`Cannot load config file: ${configPath}`, {
      suggestion:
        "Run `rag-update init` to generate a starter config, or check that the path is correct.",
      cause: err,
    });
  }

  const config = configModule.default;
  validateConfig(config);
  return config;
}
