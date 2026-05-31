import { pathToFileURL } from "url";
import { RAGPipelineConfig } from "./core/orchestrator.js";

export async function loadConfig(
  configPath: string,
): Promise<RAGPipelineConfig> {
  // Clear cache for hot reload
  delete require.cache[require.resolve(configPath)];

  const configUrl = pathToFileURL(configPath).href;
  const configModule = await import(configUrl);
  const config = configModule.default;

  if (!config.chunkers || !config.embedder || !config.vectorStore) {
    throw new Error(
      "Invalid config: missing chunkers, embedder, or vectorStore",
    );
  }

  return config;
}
