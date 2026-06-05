# vivantel/virage

Monorepo for the **Virage** ecosystem — a Git-aware RAG pipeline that turns your codebase and docs into a searchable vector store. Pick your embedder and vector store, run one command, and keep the index in sync as code changes.

[![CI](https://github.com/vivantel/virage/actions/workflows/ci-virage-core.yaml/badge.svg)](https://github.com/vivantel/virage/actions/workflows/ci-virage-core.yaml)
[![RAG Pipeline](https://github.com/vivantel/virage/actions/workflows/virage-update.yaml/badge.svg)](https://github.com/vivantel/virage/actions/workflows/virage-update.yaml)
[![Release](https://github.com/vivantel/virage/actions/workflows/release.yaml/badge.svg)](https://github.com/vivantel/virage/actions/workflows/release.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Packages

| Package                                                                           | Version                                                                                                                                                 | Description                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@vivantel/virage-core`](packages/virage-core)                                   | [![npm](https://img.shields.io/npm/v/@vivantel/virage-core.svg)](https://www.npmjs.com/package/@vivantel/virage-core)                                   | Pipeline orchestrator, interfaces, config loading                 |
| [`@vivantel/virage-cli`](packages/virage-cli)                                     | [![npm](https://img.shields.io/npm/v/@vivantel/virage-cli.svg)](https://www.npmjs.com/package/@vivantel/virage-cli)                                     | `virage` binary, init wizard, dashboard server                    |
| [`@vivantel/virage-dashboard`](packages/virage-dashboard)                         | [![npm](https://img.shields.io/npm/v/@vivantel/virage-dashboard.svg)](https://www.npmjs.com/package/@vivantel/virage-dashboard)                         | React web UI for pipeline monitoring                              |
| [`@vivantel/virage-mcp`](packages/virage-mcp)                                     | [![npm](https://img.shields.io/npm/v/@vivantel/virage-mcp.svg)](https://www.npmjs.com/package/@vivantel/virage-mcp)                                     | MCP stdio server for AI assistant integration                     |
| [`@vivantel/virage-strategies`](packages/virage-strategies)                       | [![npm](https://img.shields.io/npm/v/@vivantel/virage-strategies.svg)](https://www.npmjs.com/package/@vivantel/virage-strategies)                       | Built-in chunking strategies                                      |
| [`@vivantel/virage-embedder-openai`](packages/virage-embedder-openai)             | [![npm](https://img.shields.io/npm/v/@vivantel/virage-embedder-openai.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-openai)             | OpenAI-compatible embedder (OpenAI, Azure, GitHub Models, Ollama) |
| [`@vivantel/virage-embedder-fastembed`](packages/virage-embedder-fastembed)       | [![npm](https://img.shields.io/npm/v/@vivantel/virage-embedder-fastembed.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-fastembed)       | Fast local ONNX embeddings via FastEmbed                          |
| [`@vivantel/virage-embedder-transformers`](packages/virage-embedder-transformers) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-embedder-transformers.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-transformers) | Local embeddings via `@huggingface/transformers`                  |
| [`@vivantel/virage-store-postgres`](packages/virage-store-postgres)               | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-postgres.svg)](https://www.npmjs.com/package/@vivantel/virage-store-postgres)               | PostgreSQL + pgvector vector store                                |
| [`@vivantel/virage-store-qdrant`](packages/virage-store-qdrant)                   | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-qdrant.svg)](https://www.npmjs.com/package/@vivantel/virage-store-qdrant)                   | Qdrant vector store (local and cloud)                             |
| [`@vivantel/virage-store-lancedb`](packages/virage-store-lancedb)                 | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-lancedb.svg)](https://www.npmjs.com/package/@vivantel/virage-store-lancedb)                 | LanceDB vector store (embedded, file-based)                       |
| [`@vivantel/virage-store-chromadb`](packages/virage-store-chromadb)               | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-chromadb.svg)](https://www.npmjs.com/package/@vivantel/virage-store-chromadb)               | ChromaDB vector store (local or hosted)                           |

## Quick start

Install the core packages and at least one embedder and one vector store:

```bash
npm install @vivantel/virage-core @vivantel/virage-cli @vivantel/virage-strategies \
  @vivantel/virage-embedder-fastembed @vivantel/virage-store-lancedb
```

Generate a config interactively (scans installed plugins automatically):

```bash
npx virage init
```

Run the pipeline:

```bash
npx virage index
```

## Configuration

All configuration lives in `virage.config.json`. The `$schema` field enables IDE autocomplete and inline validation.  
`${ENV_VAR}` patterns are expanded from the environment at runtime.

```json
{
  "$schema": "./node_modules/@vivantel/virage-core/schemas/virage.config.schema.json",
  "chunkers": [
    { "patterns": ["**/*.md"], "strategy": "markdownHeaders" },
    {
      "patterns": ["src/**/*.ts"],
      "strategy": "token",
      "strategyOptions": { "maxTokens": 400 }
    }
  ],
  "embedder": {
    "package": "@vivantel/virage-embedder-fastembed",
    "config": { "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 }
  },
  "vectorStore": {
    "package": "@vivantel/virage-store-lancedb",
    "config": { "uri": "./lancedb" }
  },
  "options": {
    "rateLimitMs": 200,
    "batchSize": 20
  }
}
```

## Built-in strategies

| Strategy          | Best for                                                          |
| ----------------- | ----------------------------------------------------------------- |
| `markdownHeaders` | Markdown documentation — splits at `##` headings                  |
| `token`           | Source code, structured text — respects `maxTokens` and `overlap` |
| `semantic`        | Prose, articles — splits on paragraph/sentence boundaries         |
| `wholeFile`       | Small configs, YAML, rule files — one chunk per file              |

## CLI commands

```
virage [options] [command]

Options:
  -v, --verbose   Increase verbosity (stackable: -v, -vv, -vvv…)
  -h, --help      Display help

Commands:
  update          Run the indexing pipeline (default)
  init            Generate virage.config.json interactively
  validate        Validate config without running the pipeline
  dashboard       Start the local monitoring dashboard
  evaluate        Evaluate retrieval quality against an eval dataset
  eval-generate   Generate an eval dataset from existing chunks
  report          Show observability report from telemetry files
  chunks          Chunk analysis tools
  viz             Visualization tools
  benchmark       Performance benchmarking tools
  store           Vector store diagnostics
  experiment      Experiment tracking and statistical comparison
```

`virage index` flags:

```
Options:
  -c, --config <path>     Config file (default: virage.config.json)
  -f, --force             Force full rebuild
  --no-upload             Skip upload to vector store
  --dry-run               Show what would change without uploading
  --watch                 Re-run pipeline on file changes
  --embeddings-out <path> Override embeddings.db output path
```

## Embedders

| Package                        | Requires API key | Notes                                                                |
| ------------------------------ | ---------------- | -------------------------------------------------------------------- |
| `virage-embedder-openai`       | Yes              | OpenAI, Azure, GitHub Models, Ollama, any OpenAI-compatible endpoint |
| `virage-embedder-fastembed`    | No               | Fast local ONNX inference; good default for offline use              |
| `virage-embedder-transformers` | No               | HuggingFace Transformers.js; wider model selection                   |

The embedder model name and dimensions are tracked in `embeddings.json`. Changing either value automatically invalidates the cache and triggers a full re-embed on the next run.

## Vector stores

| Package                 | Infrastructure              | Best for                            |
| ----------------------- | --------------------------- | ----------------------------------- |
| `virage-store-lancedb`  | None (file-based)           | Local dev, CI, small projects       |
| `virage-store-postgres` | PostgreSQL + pgvector       | Production, complex SQL queries     |
| `virage-store-qdrant`   | Qdrant (Docker or cloud)    | High-scale, distributed deployments |
| `virage-store-chromadb` | ChromaDB (Docker or hosted) | Simple hosted deployments           |

## Tuning

Fine-tune indexing performance via the `options` block in `virage.config.json`:

| Option        | Default | Effect                                           |
| ------------- | ------- | ------------------------------------------------ |
| `rateLimitMs` | `0`     | Milliseconds to wait between embedding API calls |
| `batchSize`   | `100`   | Chunks sent per embedding request                |

Use `--force` to discard the incremental cache and re-index everything from scratch.  
Use `-v` / `-vv` / `-vvv` with `virage index` to increase log verbosity for debugging.

## AI assistant integration (MCP)

`@vivantel/virage-mcp` exposes your indexed knowledge to AI assistants via the [Model Context Protocol](https://modelcontextprotocol.io).

**Claude Code:**

```bash
claude mcp add virage -- npx @vivantel/virage-mcp --config ./virage.config.json
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "virage": {
      "command": "npx",
      "args": [
        "@vivantel/virage-mcp",
        "--config",
        "/path/to/virage.config.json"
      ]
    }
  }
}
```

The server exposes tools for semantic search, chunk browsing, and index statistics — all read-only.

## Dashboard

Launch the web monitoring UI to inspect chunk distribution, embedding anomalies, and pipeline status:

```bash
npx virage dashboard
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, commit conventions, and how to open a PR.

## License

MIT
