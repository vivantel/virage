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
import type { Logger } from "./interfaces/logger.js";

// ─── JSON config types ────────────────────────────────────────────────────────

interface JsonChunkerConfig {
  name?: string;
  patterns: string[];
  ignorePatterns?: string[];
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

// ─── JSON config loading ──────────────────────────────────────────────────────

function validateJsonConfig(raw: unknown): asserts raw is JsonRagConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError("virage.config.json must be a JSON object");
  }
  const c = raw as Record<string, unknown>;

  if (!Array.isArray(c.chunkers) || c.chunkers.length === 0) {
    throw new ConfigError(
      '"chunkers" must be a non-empty array in virage.config.json',
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

  validateJsonConfig(raw);
  const jsonConfig = raw as JsonRagConfig;

  const chunkers = await Promise.all(
    jsonConfig.chunkers.map(async (ch) => {
      const strategy = await resolveStrategy(
        ch.strategy as BuiltinStrategyName,
        ch.strategyOptions,
      );
      const name = ch.name ?? `${ch.strategy}:${ch.patterns[0]}`;
      return createChunker({
        name,
        patterns: ch.patterns,
        ignorePatterns: ch.ignorePatterns,
        strategy,
      });
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

  return {
    chunkers,
    embedder,
    vectorStore,
    options: jsonConfig.options,
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
