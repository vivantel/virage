import {
  OpenAICompatibleEmbedder,
  OpenAICompatibleEmbedderOptions,
} from "./embedder.js";

export interface AzureOpenAIPresetOptions {
  apiKey: string;
  endpoint: string;
  model?: string;
  dimensions?: number;
}

export interface OllamaPresetOptions {
  model: string;
  dimensions: number;
  baseURL?: string;
}

/** Pre-configured embedder for Azure OpenAI. */
export function createAzureOpenAIEmbedder(
  options: AzureOpenAIPresetOptions,
): OpenAICompatibleEmbedder {
  return new OpenAICompatibleEmbedder({
    apiKey: options.apiKey,
    baseURL: `${options.endpoint.replace(/\/$/, "")}/openai`,
    model: options.model ?? "text-embedding-3-small",
    dimensions: options.dimensions ?? 1536,
  });
}

/** Pre-configured embedder for a local Ollama server. */
export function createOllamaEmbedder(
  options: OllamaPresetOptions,
): OpenAICompatibleEmbedder {
  return new OpenAICompatibleEmbedder({
    apiKey: "ollama",
    baseURL: (options.baseURL ?? "http://localhost:11434") + "/v1",
    model: options.model,
    dimensions: options.dimensions,
  } as OpenAICompatibleEmbedderOptions);
}
