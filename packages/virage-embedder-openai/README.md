# @vivantel/virage-embedder-openai

[![npm version](https://img.shields.io/npm/v/@vivantel/virage-embedder-openai.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-openai)

OpenAI-compatible embedding provider for `@vivantel/virage-core`. Works with OpenAI, Azure OpenAI, GitHub Models, Ollama, LM Studio, and any OpenAI-compatible endpoint.

## Installation

```bash
npm install @vivantel/virage-embedder-openai
```

## Usage

### OpenAI

```typescript
import { OpenAICompatibleEmbedder } from "@vivantel/virage-embedder-openai";

const embedder = new OpenAICompatibleEmbedder({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "text-embedding-3-small",
  dimensions: 1536,
});
```

### GitHub Models (preset)

```typescript
import { createGitHubModelsEmbedder } from "@vivantel/virage-embedder-openai";

const embedder = createGitHubModelsEmbedder({
  token: process.env.GITHUB_TOKEN!,
  model: "openai/text-embedding-3-small", // optional, this is the default
});
```

### Azure OpenAI (preset)

```typescript
import { createAzureOpenAIEmbedder } from "@vivantel/virage-embedder-openai";

const embedder = createAzureOpenAIEmbedder({
  apiKey: process.env.AZURE_OPENAI_KEY!,
  endpoint: "https://my-resource.openai.azure.com",
  model: "text-embedding-3-small",
});
```

### Ollama (preset)

```typescript
import { createOllamaEmbedder } from "@vivantel/virage-embedder-openai";

const embedder = createOllamaEmbedder({
  model: "nomic-embed-text",
  dimensions: 768,
  baseURL: "http://localhost:11434", // optional, this is the default
});
```

## JSON config

```json
{
  "embedder": {
    "package": "@vivantel/virage-embedder-openai",
    "config": {
      "apiKey": "${GITHUB_TOKEN}",
      "baseURL": "https://models.github.ai/inference",
      "model": "openai/text-embedding-3-small",
      "dimensions": 1536
    }
  }
}
```

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `apiKey` | `string` | ✓ | API key |
| `model` | `string` | ✓ | Model identifier |
| `dimensions` | `number` | — | Output dimensions (default: 1536) |
| `baseURL` | `string` | — | API base URL (default: OpenAI) |
| `organizationId` | `string` | — | OpenAI organization ID |
| `maxRetries` | `number` | — | Retry attempts (default: 3) |

## License

MIT
