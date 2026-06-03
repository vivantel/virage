# vivantel/virage

Monorepo for `@vivantel/virage-core` — a Git-aware RAG pipeline that turns your codebase into a searchable vector store.

[![CI](https://github.com/vivantel/virage/actions/workflows/ci-virage-core.yaml/badge.svg)](https://github.com/vivantel/virage/actions/workflows/ci-virage-core.yaml)
[![RAG Pipeline](https://github.com/vivantel/virage/actions/workflows/virage-update.yaml/badge.svg)](https://github.com/vivantel/virage/actions/workflows/virage-update.yaml)
[![Release](https://github.com/vivantel/virage/actions/workflows/release.yaml/badge.svg)](https://github.com/vivantel/virage/actions/workflows/release.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Packages

| Package | Version | Description |
| --- | --- | --- |
| [`@vivantel/virage-core`](packages/virage-core) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-core.svg)](https://www.npmjs.com/package/@vivantel/virage-core) | Pipeline orchestrator, interfaces, CLI |
| [`@vivantel/virage-strategies`](packages/virage-strategies) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-strategies.svg)](https://www.npmjs.com/package/@vivantel/virage-strategies) | Built-in chunking strategies |
| [`@vivantel/virage-embedder-openai`](packages/virage-embedder-openai) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-embedder-openai.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-openai) | OpenAI-compatible embedder (OpenAI, Azure, GitHub Models, Ollama) |
| [`@vivantel/virage-embedder-transformers`](packages/virage-embedder-transformers) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-embedder-transformers.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-transformers) | Local embeddings via `@huggingface/transformers` |
| [`@vivantel/virage-embedder-fastembed`](packages/virage-embedder-fastembed) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-embedder-fastembed.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-fastembed) | Fast local ONNX embeddings via FastEmbed |
| [`@vivantel/virage-store-postgres`](packages/virage-store-postgres) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-postgres.svg)](https://www.npmjs.com/package/@vivantel/virage-store-postgres) | PostgreSQL + pgvector vector store |
| [`@vivantel/virage-store-qdrant`](packages/virage-store-qdrant) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-qdrant.svg)](https://www.npmjs.com/package/@vivantel/virage-store-qdrant) | Qdrant vector store (local and cloud) |
| [`@vivantel/virage-store-lancedb`](packages/virage-store-lancedb) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-lancedb.svg)](https://www.npmjs.com/package/@vivantel/virage-store-lancedb) | LanceDB vector store (embedded, file-based) |
| [`@vivantel/virage-store-chromadb`](packages/virage-store-chromadb) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-chromadb.svg)](https://www.npmjs.com/package/@vivantel/virage-store-chromadb) | ChromaDB vector store (local or hosted) |

## Quick start

```bash
npm install @vivantel/virage-core @vivantel/virage-strategies @vivantel/virage-embedder-openai
```

Generate a config:

```bash
npx virage init
```

The init wizard scans your project, lets you pick an embedder and vector store, and writes secrets to `.env`:

Then run the pipeline:

```bash
npx virage
```

## Config format

All configuration is in `virage.config.json`. `${ENV_VAR}` patterns are expanded from the environment at runtime.

```json
{
  "$schema": "./node_modules/@vivantel/virage-core/schemas/virage.config.schema.json",
  "chunkers": [
    { "patterns": ["**/*.md"], "strategy": "markdownHeaders" },
    { "patterns": ["src/**/*.ts"], "strategy": "token" }
  ],
  "embedder": {
    "package": "@vivantel/virage-embedder-openai",
    "config": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "text-embedding-3-small",
      "dimensions": 1536
    }
  },
  "vectorStore": {
    "package": "@vivantel/virage-store-qdrant",
    "config": { "url": "${QDRANT_URL}", "apiKey": "${QDRANT_API_KEY}" }
  }
}
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
virage [options]

Options:
  -c, --config <path>          Config file (default: virage.config.json)
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
