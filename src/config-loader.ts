import { pathToFileURL } from "url";
import { RAGPipelineConfig } from "./core/orchestrator.js";
import { ConfigError } from "./core/errors.js";

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

export async function loadConfig(
  configPath: string,
): Promise<RAGPipelineConfig> {
  let configModule;
  try {
    const configUrl = pathToFileURL(configPath).href;
    configModule = await import(configUrl);
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
