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
| [`@vivantel/virage-code-chunk-chunker`](packages/virage-code-chunk-chunker)       | [![npm](https://img.shields.io/npm/v/@vivantel/virage-code-chunk-chunker.svg)](https://www.npmjs.com/package/@vivantel/virage-code-chunk-chunker)       | AST-aware code chunking for TS, JS, Python, Go, Java              |

## Quick start

Install the core packages and at least one embedder and one vector store:

```bash
npm install @vivantel/virage-core @vivantel/virage-cli @vivantel/virage-strategies \
  @vivantel/virage-embedder-fastembed @vivantel/virage-store-lancedb
```

Generate a config interactively (detects file types and selects strategies automatically; installs required packages including `@vivantel/virage-code-chunk-chunker` for code projects):

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
    { "patterns": ["src/**/*.ts", "src/**/*.tsx"], "strategy": "codeChunkAst" }
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

| Strategy          | Best for                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `markdownHeaders` | Markdown documentation — splits at `##` headings                                                                 |
| `codeChunkAst`    | Source code (TS, JS, Python, Go, Java) — AST-aware splits at function/class boundaries; requires `@vivantel/virage-code-chunk-chunker` |
| `token`           | Source code, structured text — respects `maxTokens` and `overlap`                                               |
| `semantic`        | Prose, articles — splits on paragraph/sentence boundaries                                                        |
| `wholeFile`       | Small configs, YAML, rule files — one chunk per file                                                             |

## CLI commands

All commands have short aliases. Run `virage --help` to see the full list.

```
virage [options] [command]

Options:
  -v, --verbose   Increase verbosity (stackable: -v, -vv, -vvv…)
  -h, --help      Display help

Commands:
  index     (i)     Run the indexing pipeline
  init              Generate virage.config.json interactively
  update    (up)    Update virage ecosystem packages and resync agent configs
  check     (c)     Validate embedder config matches the stored index
  validate  (val)   Validate config without running the pipeline
  dashboard (d)     Start the local monitoring dashboard
  query     (q)     Semantic search over the indexed knowledge base
  eval      (e)     Evaluation tools (run / generate / save / list / compare)
  report    (r)     Show observability report from pipeline runs
  chunks            Chunk analysis tools
  viz               Visualization tools
  benchmark         Performance benchmarking tools
  store             Vector store diagnostics
  telemetry         Manage telemetry settings and data
  install-hooks (hooks)  Install git hooks for auto-indexing
```

`virage index` flags:

```
Options:
  -c, --config <path>     Config file (default: virage.config.json)
  -f, --force             Force full rebuild
  --no-upload             Skip upload to vector store
  --dry-run               Show what would change without uploading
  --watch                 Re-run pipeline on file changes
  (Use VIRAGE_DIR env var to override the .virage/ directory path)
```

`virage eval` subcommands:

```
virage eval run              One-shot retrieval quality check (precision, MRR, hit rate)
virage eval generate (gen)   Generate an eval dataset from existing indexed chunks
virage eval save --name <n>  Run evaluation and save results for later comparison
virage eval list             List saved evaluation runs
virage eval compare          Bootstrap significance test between two saved runs
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

Launch the web monitoring UI to inspect chunk distribution, embedding anomalies, pipeline status, search, and experiments:

```bash
npx virage dashboard        # start on port 3000
npx virage dashboard --port 8080 --verbose  # custom port + request logging
```

## Use cases

See [docs/USE_CASES.md](docs/USE_CASES.md) for detailed scenarios:

- Onboarding new engineers with instant codebase search
- AI code review with full codebase context, not just the diff
- Keeping docs in sync with code via post-commit hooks
- Zero-cost local RAG for private or air-gapped codebases
- Multi-strategy indexing for mixed-content monorepos
- Measuring retrieval quality before and after config changes
- Cost-bounded CI indexing — only changed files are re-embedded
- Sharing project knowledge across Claude Code, Copilot, and Codex simultaneously

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for planned features, an honest assessment of current gaps, and evaluation targets. Highlights:

- **Hybrid search** (BM25 + vector fusion) — the highest-impact retrieval improvement not yet shipped
- **Cross-file import graph indexing** — so agents can follow call chains, not just file contents
- **Re-ranking layer** — cross-encoder or LLM-based, for when top-K precision matters more than latency
- **Cost estimator** (`virage estimate`) — projected token count and API cost before any embedding call
- **PR diff mode** — index only the files changed in a pull request, in an isolated namespace
- **Query analytics dashboard** — track what's being searched and which chunks are actually useful

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, commit conventions, and how to open a PR.

## License

MIT
