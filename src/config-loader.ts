import { pathToFileURL } from "url";
import { RAGPipelineConfig } from "./core/orchestrator.js";
import { ConfigError } from "./core/errors.js";

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

  const config = configModule.default as RAGPipelineConfig | undefined;

  if (!config || !config.chunkers || !config.embedder || !config.vectorStore) {
    throw new ConfigError(
      "Config is missing required fields: chunkers, embedder, or vectorStore",
      {
        suggestion:
          "Ensure your config file has a default export with chunkers, embedder, and vectorStore.",
      },
    );
  }

  return config;
}
