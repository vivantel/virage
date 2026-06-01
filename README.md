# vivantel/rag-core

Monorepo for `@vivantel/rag-core` — a Git-aware RAG pipeline that turns your codebase into a searchable vector store.

[![CI](https://github.com/vivantel/rag_core/actions/workflows/ci-rag-core.yaml/badge.svg)](https://github.com/vivantel/rag_core/actions/workflows/ci-rag-core.yaml)
[![Release](https://github.com/vivantel/rag_core/actions/workflows/release.yaml/badge.svg)](https://github.com/vivantel/rag_core/actions/workflows/release.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Packages

| Package | Version | Description |
| --- | --- | --- |
| [`@vivantel/rag-core`](packages/rag-core) | [![npm](https://img.shields.io/npm/v/@vivantel/rag-core.svg)](https://www.npmjs.com/package/@vivantel/rag-core) | Pipeline orchestrator, interfaces, CLI |
| [`@vivantel/rag-strategies`](packages/rag-strategies) | [![npm](https://img.shields.io/npm/v/@vivantel/rag-strategies.svg)](https://www.npmjs.com/package/@vivantel/rag-strategies) | Built-in chunking strategies |
| [`@vivantel/rag-embedder-openai`](packages/rag-embedder-openai) | [![npm](https://img.shields.io/npm/v/@vivantel/rag-embedder-openai.svg)](https://www.npmjs.com/package/@vivantel/rag-embedder-openai) | OpenAI-compatible embedder (OpenAI, Azure, GitHub Models, Ollama) |
| [`@vivantel/rag-embedder-transformers`](packages/rag-embedder-transformers) | [![npm](https://img.shields.io/npm/v/@vivantel/rag-embedder-transformers.svg)](https://www.npmjs.com/package/@vivantel/rag-embedder-transformers) | Local embeddings via `@huggingface/transformers` |
| [`@vivantel/rag-embedder-fastembed`](packages/rag-embedder-fastembed) | [![npm](https://img.shields.io/npm/v/@vivantel/rag-embedder-fastembed.svg)](https://www.npmjs.com/package/@vivantel/rag-embedder-fastembed) | Fast local ONNX embeddings via FastEmbed |

## Quick start

```bash
npm install @vivantel/rag-core @vivantel/rag-strategies @vivantel/rag-embedder-openai
```

Generate a config:

```bash
npx rag-update init
```

The init wizard scans your project for known file types and lets you pick a config format:

- **JSON** (`rag.config.json`) — declarative, no TypeScript required
- **TypeScript** (`rag.config.ts`) — escape hatch for custom providers

Then run the pipeline:

```bash
npx rag-update
```

## Config formats

### JSON config (recommended)

```json
{
  "$schema": "./node_modules/@vivantel/rag-core/schemas/rag.config.schema.json",
  "chunkers": [
    { "patterns": ["**/*.md"], "strategy": "markdownHeaders" },
    { "patterns": ["src/**/*.ts"], "strategy": "token" }
  ],
  "embedder": {
    "package": "@vivantel/rag-embedder-openai",
    "config": {
      "apiKey": "${GITHUB_TOKEN}",
      "baseURL": "https://models.github.ai/inference",
      "model": "openai/text-embedding-3-small",
      "dimensions": 1536
    }
  },
  "vectorStore": {
    "package": "@vivantel/rag-store-postgres",
    "config": { "connectionString": "${DATABASE_URL}" }
  }
}
```

`${ENV_VAR}` patterns are expanded from the environment at runtime.

### TypeScript config (custom providers)

```typescript
import type { RAGPipelineConfig } from "@vivantel/rag-core";
import { createChunker } from "@vivantel/rag-core";
import { markdownHeadersStrategy, tokenStrategy } from "@vivantel/rag-strategies";
import { createGitHubModelsEmbedder } from "@vivantel/rag-embedder-openai";

const config: RAGPipelineConfig = {
  chunkers: [
    createChunker({ patterns: ["docs/**/*.md"], strategy: markdownHeadersStrategy() }),
    createChunker({ patterns: ["src/**/*.ts"], strategy: tokenStrategy() }),
  ],
  embedder: createGitHubModelsEmbedder({ token: process.env.GITHUB_TOKEN! }),
  vectorStore: myVectorStore,
};

export default config;
```

## Built-in strategies

| Strategy | Best for |
| --- | --- |
| `markdownHeaders` | Markdown documentation |
| `token` | Source code, structured text |
| `semantic` | Prose, articles |
| `wholeFile` | Small configs, YAML, rule files |

## CLI flags

```
rag-update [options]

Options:
  -c, --config <path>          Config file (auto-detects rag.config.json then rag.config.ts)
  -f, --force                  Force full rebuild
  --skip-upload                Skip upload to vector store
  --chunks-file <path>         Override chunks.json path
  --embeddings-file <path>     Override embeddings.json path
  -h, --help                   Show help

Commands:
  init                         Generate a starter config interactively
```

## License

MIT
