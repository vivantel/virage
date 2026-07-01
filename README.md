# vivantel/virage

Monorepo for the **Virage** ecosystem — a Git-aware RAG pipeline that turns your codebase and docs into a searchable vector store. Pick your embedder and vector store, run one command, and keep the index in sync as code changes.

[![CI](https://github.com/vivantel/virage/actions/workflows/ci.yaml/badge.svg)](https://github.com/vivantel/virage/actions/workflows/ci.yaml)
[![RAG Pipeline](https://github.com/vivantel/virage/actions/workflows/virage-update.yaml/badge.svg)](https://github.com/vivantel/virage/actions/workflows/virage-update.yaml)
[![Release](https://github.com/vivantel/virage/actions/workflows/release.yaml/badge.svg)](https://github.com/vivantel/virage/actions/workflows/release.yaml)
[![Quality](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/vivantel/virage/gh-pages/badges/quality.json)](https://vivantel.github.io/virage/dev/bench/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Packages

### Core & CLI

| Package | Version | Description |
| ------- | ------- | ----------- |
| [`@vivantel/virage-core`](packages/virage-core) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-core.svg)](https://www.npmjs.com/package/@vivantel/virage-core) | Pipeline orchestrator, interfaces, config loading |
| [`@vivantel/virage-cli`](packages/virage-cli) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-cli.svg)](https://www.npmjs.com/package/@vivantel/virage-cli) | `virage` binary, init wizard, dashboard server |
| [`@vivantel/virage-dashboard`](packages/virage-dashboard) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-dashboard.svg)](https://www.npmjs.com/package/@vivantel/virage-dashboard) | React web UI for pipeline monitoring |
| [`@vivantel/virage-mcp`](packages/virage-mcp) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-mcp.svg)](https://www.npmjs.com/package/@vivantel/virage-mcp) | MCP stdio server for AI assistant integration |

### Chunkers

| Package | Version | Description |
| ------- | ------- | ----------- |
| [`@vivantel/virage-chunker-ce-ast`](packages/virage-chunker-ce-ast) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-chunker-ce-ast.svg)](https://www.npmjs.com/package/@vivantel/virage-chunker-ce-ast) | Shared AST walker used by all CE native chunkers |
| [`@vivantel/virage-chunker-ce-ts`](packages/virage-chunker-ce-ts) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-chunker-ce-ts.svg)](https://www.npmjs.com/package/@vivantel/virage-chunker-ce-ts) | TypeScript / JavaScript chunker (pure TS, no native binary) |
| [`@vivantel/virage-chunker-ce-md`](packages/virage-chunker-ce-md) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-chunker-ce-md.svg)](https://www.npmjs.com/package/@vivantel/virage-chunker-ce-md) | Markdown / MDX chunker (Rust native, comrak) |
| [`@vivantel/virage-chunker-ce-pdf`](packages/virage-chunker-ce-pdf) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-chunker-ce-pdf.svg)](https://www.npmjs.com/package/@vivantel/virage-chunker-ce-pdf) | PDF chunker — text layer extraction (Rust native, lopdf) |
| [`@vivantel/virage-chunker-ce-docx`](packages/virage-chunker-ce-docx) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-chunker-ce-docx.svg)](https://www.npmjs.com/package/@vivantel/virage-chunker-ce-docx) | DOCX chunker (Rust native, docx-rs) |
| [`@vivantel/virage-chunker-ce-latex`](packages/virage-chunker-ce-latex) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-chunker-ce-latex.svg)](https://www.npmjs.com/package/@vivantel/virage-chunker-ce-latex) | LaTeX chunker (Rust native, custom lexer/parser) |
| [`@vivantel/virage-code-chunk-chunker`](packages/virage-code-chunk-chunker) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-code-chunk-chunker.svg)](https://www.npmjs.com/package/@vivantel/virage-code-chunk-chunker) | AST-aware code chunking for TS, JS, Python, Go, Java |

### Embedders

| Package | Version | Description |
| ------- | ------- | ----------- |
| [`@vivantel/virage-embedder-openai`](packages/virage-embedder-openai) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-embedder-openai.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-openai) | OpenAI-compatible embedder (OpenAI, Azure, GitHub Models, Ollama) |
| [`@vivantel/virage-embedder-fastembed`](packages/virage-embedder-fastembed) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-embedder-fastembed.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-fastembed) | Fast local ONNX embeddings via FastEmbed |
| [`@vivantel/virage-embedder-transformers`](packages/virage-embedder-transformers) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-embedder-transformers.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-transformers) | Local embeddings via `@huggingface/transformers` |

### Vector Stores

| Package | Version | Description |
| ------- | ------- | ----------- |
| [`@vivantel/virage-store-lancedb`](packages/virage-store-lancedb) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-lancedb.svg)](https://www.npmjs.com/package/@vivantel/virage-store-lancedb) | LanceDB vector store (embedded, file-based) |
| [`@vivantel/virage-store-qdrant`](packages/virage-store-qdrant) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-qdrant.svg)](https://www.npmjs.com/package/@vivantel/virage-store-qdrant) | Qdrant vector store (local and cloud) |
| [`@vivantel/virage-store-postgres`](packages/virage-store-postgres) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-postgres.svg)](https://www.npmjs.com/package/@vivantel/virage-store-postgres) | PostgreSQL + pgvector vector store |
| [`@vivantel/virage-store-chromadb`](packages/virage-store-chromadb) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-store-chromadb.svg)](https://www.npmjs.com/package/@vivantel/virage-store-chromadb) | ChromaDB vector store (local or hosted) |

### Re-rankers

| Package | Version | Description |
| ------- | ------- | ----------- |
| [`@vivantel/virage-reranker-cross-encoder`](packages/virage-reranker-cross-encoder) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-reranker-cross-encoder.svg)](https://www.npmjs.com/package/@vivantel/virage-reranker-cross-encoder) | Local cross-encoder re-ranker (ONNX, no API key required) |
| [`@vivantel/virage-reranker-llm`](packages/virage-reranker-llm) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-reranker-llm.svg)](https://www.npmjs.com/package/@vivantel/virage-reranker-llm) | LLM-based re-ranker using the Anthropic API |

### Agent plugins

| Package | Version | Description |
| ------- | ------- | ----------- |
| [`@vivantel/virage-agent-core`](packages/virage-agent-core) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-agent-core.svg)](https://www.npmjs.com/package/@vivantel/virage-agent-core) | Base interfaces and utilities for agent plugins |
| [`@vivantel/virage-agent-claude`](packages/virage-agent-claude) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-agent-claude.svg)](https://www.npmjs.com/package/@vivantel/virage-agent-claude) | Claude Code agent plugin |
| [`@vivantel/virage-agent-copilot`](packages/virage-agent-copilot) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-agent-copilot.svg)](https://www.npmjs.com/package/@vivantel/virage-agent-copilot) | GitHub Copilot agent plugin |
| [`@vivantel/virage-agent-codex`](packages/virage-agent-codex) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-agent-codex.svg)](https://www.npmjs.com/package/@vivantel/virage-agent-codex) | OpenAI Codex agent plugin |
| [`@vivantel/virage-agent-antigravity`](packages/virage-agent-antigravity) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-agent-antigravity.svg)](https://www.npmjs.com/package/@vivantel/virage-agent-antigravity) | Google Antigravity agent plugin |
| [`@vivantel/virage-skills`](packages/virage-skills) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-skills.svg)](https://www.npmjs.com/package/@vivantel/virage-skills) | AI agent skills for Claude Code, Copilot, and Codex |

### Utilities

| Package | Version | Description |
| ------- | ------- | ----------- |
| [`@vivantel/virage-git-isomorphic`](packages/virage-git-isomorphic) | [![npm](https://img.shields.io/npm/v/@vivantel/virage-git-isomorphic.svg)](https://www.npmjs.com/package/@vivantel/virage-git-isomorphic) | Pure-JS git source using isomorphic-git (no subprocess spawning) |

## Quick start

Install the CLI globally:

```bash
npm install -g @vivantel/virage-cli
```

Set up a project (interactive wizard selects embedder, vector store, re-ranker, hybrid search, and agent plugins — and installs everything):

```bash
cd my-project
virage init
```

Run the pipeline:

```bash
virage index
```

## Configuration

All configuration lives in `virage.config.json`. The `$schema` field enables IDE autocomplete and inline validation. `${ENV_VAR}` patterns are expanded from the environment at runtime. `pluginVersions` records the exact versions installed by `virage init` / `virage update`.

```json
{
  "$schema": "https://unpkg.com/@vivantel/virage-core/schemas/virage.config.schema.json",
  "chunking": {
    "exclude": [
      "**/vendor/**", "**/*.min.js", "**/*.lock",
      "**/dist/**", "**/node_modules/**"
    ],
    "chunkers": [
      { "package": "@vivantel/virage-chunker-ce-md" },
      { "package": "@vivantel/virage-code-chunk-chunker" }
    ]
  },
  "agents": [{ "package": "@vivantel/virage-agent-claude" }],
  "embedder": {
    "package": "@vivantel/virage-embedder-fastembed",
    "config": { "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 }
  },
  "vectorStore": {
    "package": "@vivantel/virage-store-lancedb",
    "config": { "uri": ".virage/lancedb" }
  },
  "search": {
    "hybrid": true,
    "hybridAlpha": 0.6
  },
  "pluginVersions": {
    "@vivantel/virage-embedder-fastembed": "0.2.66",
    "@vivantel/virage-store-lancedb": "0.2.70",
    "@vivantel/virage-code-chunk-chunker": "0.1.50",
    "@vivantel/virage-agent-claude": "0.2.27"
  },
  "options": {
    "rateLimitMs": 200,
    "batchSize": 20
  }
}
```

The `chunking` section replaces the old root-level `chunkers` array. Old configs with `chunkers` at the root are automatically normalized at load time — no manual migration required. `virage init` always generates the new format.

**`chunking.exclude`** accepts glob patterns applied to all chunkers before any file is processed. `virage init` seeds this with sensible per-ecosystem defaults (Node, Java, .NET, Go, C/C++). Per-chunker exclusions remain available as `ignorePatterns` inside each chunker entry.

## CLI commands

All commands have short aliases. Run `virage --help` to see the full list.

```
virage [options] [command]

Options:
  -v, --verbose   Increase verbosity (stackable: -v, -vv, -vvv…)
  --no-banner     Suppress the startup banner (also: VIRAGE_NO_BANNER=1)
  -h, --help      Display help

Commands:
  index     (i)     Run the indexing pipeline
  init              Generate virage.config.json interactively
  update    (up)    Update virage ecosystem packages and resync agent configs
  check     (c)     Validate embedder config matches the stored index
  validate  (val)   Validate config without running the pipeline
  dashboard (d)     Start the local monitoring dashboard
  query     (q)     Semantic search over the indexed knowledge base
  quality   (ql)    Quality system: self-assessment, retrieval eval, benchmarks
  report    (r)     Show observability report from pipeline runs
  chunks            Chunk analysis tools
  viz               Visualization tools
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

`virage quality` (ql) — 26-metric pipeline self-assessment, retrieval eval, and performance benchmarks. See [docs/quality.md](docs/quality.md) for the full command reference.

## Chunkers

Chunkers split source files into embeddable chunks. Multiple chunkers run in parallel, each targeting the file types it handles best.

| Package | Language / format | Notes |
| ------- | ----------------- | ----- |
| `virage-chunker-ce-ast` | All (shared AST walker) | Required by all CE native chunkers |
| `virage-chunker-ce-ts` | TypeScript / JavaScript | Pure TS, no native binary |
| `virage-chunker-ce-md` | Markdown / MDX | Rust native (comrak) |
| `virage-chunker-ce-pdf` | PDF | Rust native (lopdf) |
| `virage-chunker-ce-docx` | DOCX | Rust native (docx-rs) |
| `virage-chunker-ce-latex` | LaTeX | Rust native (custom lexer/parser) |
| `virage-code-chunk-chunker` | TS, JS, Python, Go, Java | AST-aware, powered by code-chunk |

CE chunkers ship as pre-built native binaries on npm — no Rust toolchain required. Configure chunkers under `chunking.chunkers` in `virage.config.json`:

```json
{
  "chunking": {
    "chunkers": [
      { "package": "@vivantel/virage-chunker-ce-md" },
      { "package": "@vivantel/virage-chunker-ce-pdf" },
      { "package": "@vivantel/virage-chunker-ce-ts" },
      { "package": "@vivantel/virage-code-chunk-chunker", "include": ["**/*.py", "**/*.go"] }
    ]
  }
}
```

## Embedders

| Package | Requires API key | Notes |
| ------- | ---------------- | ----- |
| `virage-embedder-openai` | Yes | OpenAI, Azure, GitHub Models, Ollama, any OpenAI-compatible endpoint |
| `virage-embedder-fastembed` | No | Fast local ONNX inference; good default for offline use |
| `virage-embedder-transformers` | No | HuggingFace Transformers.js; wider model selection |

The embedder model name and dimensions are tracked in `embeddings.json`. Changing either value automatically invalidates the cache and triggers a full re-embed on the next run.

## Vector stores

| Package | Infrastructure | Best for |
| ------- | -------------- | -------- |
| `virage-store-lancedb` | None (file-based) | Local dev, CI, small projects |
| `virage-store-postgres` | PostgreSQL + pgvector | Production, complex SQL queries |
| `virage-store-qdrant` | Qdrant (Docker or cloud) | High-scale, distributed deployments |
| `virage-store-chromadb` | ChromaDB (Docker or hosted) | Simple hosted deployments |

## Re-rankers

Optional post-retrieval re-rankers re-score the top-K candidates for higher precision. Configured under `search.reranker` in `virage.config.json`.

| Package | Requires API key | Notes |
| ------- | ---------------- | ----- |
| `@vivantel/virage-reranker-cross-encoder` | No | Local ONNX cross-encoder; no API key required |
| `@vivantel/virage-reranker-llm` | Yes (Anthropic) | LLM-based re-ranker using claude-haiku-4-5 |

## Tuning

Fine-tune indexing performance via the `options` block in `virage.config.json`:

| Option | Default | Effect |
| ------ | ------- | ------ |
| `rateLimitMs` | `0` | Milliseconds to wait between embedding API calls |
| `batchSize` | `100` | Chunks sent per embedding request |
| `chunkConcurrency` | CPU core count | Number of files chunked in parallel (I/O + AST parsing) |
| `concurrency` | `1` | Parallel embedding requests (for remote embedders only) |

Local embedder models are cached in `~/.virage/models` (overridable with `VIRAGE_GLOBAL_DIR`).

Use `--force` to discard the incremental cache and re-index everything from scratch.  
Use `-v` / `-vv` / `-vvv` with `virage index` to increase log verbosity for debugging.

## AI assistant integration

Agent plugins configure your coding assistant to use Virage for semantic search and context retrieval. Select one or more agents during `virage init` — the plugin is installed and configured automatically.

| Agent | Plugin | What gets configured |
| ----- | ------ | -------------------- |
| Claude Code | `@vivantel/virage-agent-claude` | MCP server registration, slash commands, skills |
| GitHub Copilot | `@vivantel/virage-agent-copilot` | `.github/copilot/` hooks and instructions |
| OpenAI Codex | `@vivantel/virage-agent-codex` | `.codex/` hooks |
| Google Antigravity | `@vivantel/virage-agent-antigravity` | `.antigravity/` hooks |

Run `virage update` to resync agent configs after upgrading plugin packages.

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

Planned features:

- **Cross-file import graph indexing** — so agents can follow call chains across files, not just within them
- **Cost estimator** (`virage estimate`) — projected token count and API cost before any embedding call
- **PR diff mode** — index only the files changed in a pull request, in an isolated namespace
- **Semantic deduplication** — skip near-duplicate chunks before embedding to reduce index bloat
- **GitHub Actions integration** — official `vivantel/virage-action` composite action for CI-driven indexing

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, commit conventions, and how to open a PR.

## License

MIT
