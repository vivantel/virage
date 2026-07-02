# @vivantel/virage-embedder-openai

[![npm version](https://img.shields.io/npm/v/@vivantel/virage-embedder-openai.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-openai)

OpenAI-compatible embedding provider for `@vivantel/virage-core`. Works with OpenAI, Azure OpenAI, Ollama, LM Studio, GitHub Models, and any OpenAI-compatible endpoint.

→ [Monorepo docs: docs/packages/embedders.md](../../docs/packages/embedders.md)

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

### GitHub Models (via generic OpenAI-compatible endpoint)

```typescript
import { OpenAICompatibleEmbedder } from "@vivantel/virage-embedder-openai";

const embedder = new OpenAICompatibleEmbedder({
  apiKey: process.env.GITHUB_TOKEN!,
  baseURL: "https://models.github.ai/inference",
  model: "openai/text-embedding-3-small",
  dimensions: 1536,
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
      "apiKey": "${OPENAI_API_KEY}",
      "model": "text-embedding-3-small",
      "dimensions": 1536
    }
  }
}
```

Any OpenAI-compatible endpoint (including GitHub Models, Azure OpenAI, Ollama) can be used by adding a `baseURL` field to the config.

## Options

| Option           | Type     | Required | Description                       |
| ---------------- | -------- | -------- | --------------------------------- |
| `apiKey`         | `string` | ✓        | API key                           |
| `model`          | `string` | ✓        | Model identifier                  |
| `dimensions`     | `number` | —        | Output dimensions (default: 1536) |
| `baseURL`        | `string` | —        | API base URL (default: OpenAI)    |
| `organizationId` | `string` | —        | OpenAI organization ID            |
| `maxRetries`     | `number` | —        | Retry attempts (default: 3)       |

## License

MIT
