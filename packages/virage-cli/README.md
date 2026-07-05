# @vivantel/virage-cli

CLI for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## Installation

Install the CLI globally:

```bash
npm install -g @vivantel/virage-cli
```

Then set up a project:

```bash
cd my-project
virage init   # interactive wizard: selects embedder, vector store, agents; installs plugins
virage index  # index the codebase
```

`virage init` installs all required plugins (embedder, vector store, re-ranker, chunker, and agent plugins) to either `~/.virage/plugins` (global) or `$PROJECT_DIR/.virage/plugins` (local). Installed versions are recorded in `virage.config.json` under `pluginVersions`.

## Plugin management

Virage extensions — embedders, vector stores, re-rankers, and agent plugins — are managed by the CLI and stored in dedicated plugin directories:

| Scope | Path |
|-------|------|
| Local (per-project) | `$PROJECT_DIR/.virage/plugins/` |
| Global (all projects) | `~/.virage/plugins/` |

Load priority: local > global. Install scope is chosen during `virage init`.

Use `virage update` to update installed plugins and resync agent configs.

## Commands

Every top-level command has a single-key alias — use `virage --help` to see all of them. For full per-command reference see [docs/cli/](../../docs/cli/).

### Pipeline

| Command | Alias | Description |
|---------|-------|-------------|
| `virage index` | `i` | Run the RAG indexing pipeline |
| `virage check` | `c` | Validate that the current embedder config matches the stored index |
| `virage validate` | `val` | Validate config without running the pipeline |
| `virage query <text>` | `q` | Semantic search over the indexed knowledge base |

### Setup & lifecycle

| Command | Alias | Description |
|---------|-------|-------------|
| `virage init` | — | Interactive wizard: configure embedder, vector store, re-ranker, hybrid search, and agent plugins; installs all selected plugins |
| `virage update` | `up` | Check for outdated plugins, update selected ones, and resync agent configs (`--force` reinstalls; `--yes` skips selection) |
| `virage install-hooks` | `hooks` | Install git hooks for auto-indexing on pull/branch switch |
| `virage uninstall` | `un` | Remove git hooks, plugin dirs, embeddings DB, config, and optionally the global CLI |

### Agent utilities

| Command | Alias | Description |
|---------|-------|-------------|
| `virage usage` | `use` | Print per-prompt token usage for the current Claude Code session |
| `virage read-skill-summary <name>` | `skill` | Print the summary for a named Virage skill |

### Evaluation

All evaluation commands live under the `virage eval` (`e`) parent:

| Command | Alias | Description |
|---------|-------|-------------|
| `virage eval run` | `e run` | One-shot retrieval quality check (precision@5/10, MRR, hit rate) |
| `virage eval generate` | `e gen` | Generate an eval dataset from existing indexed chunks |
| `virage eval save --name <n>` | — | Run evaluation and save results under a name for later comparison |
| `virage eval list` | — | List saved evaluation runs |
| `virage eval compare --baseline --candidate` | — | Bootstrap significance test between two saved runs |
| `virage report` | `r` | Show observability report from pipeline runs |

### Diagnostics

| Command | Alias | Description |
|---------|-------|-------------|
| `virage store stats` | — | Show vector index quality metrics |
| `virage store perf` | — | Show query performance report |
| `virage benchmark embedder` | — | Benchmark embedder latency and throughput |
| `virage chunks report` | — | Show chunk cohesion report |
| `virage viz embeddings` | — | Generate a 2D visualization of the embedding space |
| `virage dashboard` | `d` | Start a local RAG monitoring dashboard |

### Telemetry

| Command | Description |
|---------|-------------|
| `virage telemetry status` | Show telemetry status, buffer size, and endpoint health |
| `virage telemetry on` | Enable telemetry collection |
| `virage telemetry off` | Disable telemetry collection and clear local buffer |
| `virage telemetry init` | Interactive telemetry configuration wizard |
| `virage telemetry preview` | Preview the telemetry payload (no transmission) |
| `virage telemetry flush` | Flush buffered telemetry to the configured endpoint |

## Configuration

All configuration lives in `virage.config.json`. The `$schema` field enables IDE autocomplete and inline validation. `${ENV_VAR}` patterns are expanded from the environment at runtime.

```json
{
  "$schema": "https://unpkg.com/@vivantel/virage-core/schemas/virage.config.schema.json",
  "chunking": {
    "exclude": [
      "**/vendor/**", "**/*.min.js", "**/*.min.css",
      "**/*.lock", "**/dist/**", "**/target/**"
    ],
    "chunkers": [
      { "patterns": ["**/*.md"], "strategy": "markdownHeaders" },
      { "patterns": ["src/**/*.ts"], "strategy": "codeChunkAst" }
    ]
  },
  "agents": ["claude-code"],
  "embedder": {
    "package": "@vivantel/virage-embedder-transformers",
    "config": { "model": "Xenova/all-MiniLM-L6-v2", "dimensions": 384 }
  },
  "vectorStore": {
    "package": "@vivantel/virage-store-lancedb",
    "config": { "uri": ".virage/lancedb" }
  },
  "search": {
    "hybrid": true,
    "hybridAlpha": 0.6,
    "reranker": {
      "package": "@vivantel/virage-reranker-cross-encoder",
      "config": { "model": "Xenova/ms-marco-MiniLM-L-6-v2", "topK": 5 }
    }
  },
  "pluginVersions": {
    "@vivantel/virage-embedder-transformers": "0.2.36",
    "@vivantel/virage-store-lancedb": "0.2.36",
    "@vivantel/virage-reranker-cross-encoder": "0.1.8",
    "@vivantel/virage-code-chunk-chunker": "0.1.19",
    "@vivantel/virage-agent-claude": "0.2.24"
  }
}
```

`chunking.exclude` accepts glob patterns excluded from all chunkers globally. `virage init` seeds this with ecosystem-specific defaults. Old configs with `chunkers` at the root are auto-normalized on load.

## Embedders

| Package | Requires API key | Notes |
|---------|-----------------|-------|
| `@vivantel/virage-embedder-openai` | Yes | OpenAI, Azure, GitHub Models, Ollama, any OpenAI-compatible endpoint |
| `@vivantel/virage-embedder-fastembed` | No | Fast local ONNX inference; good default for offline use |
| `@vivantel/virage-embedder-transformers` | No | HuggingFace Transformers.js; wider model selection |

## Vector stores

| Package | Infrastructure | Best for |
|---------|---------------|---------|
| `@vivantel/virage-store-lancedb` | None (file-based) | Local dev, CI, small projects |
| `@vivantel/virage-store-postgres` | PostgreSQL + pgvector | Production, complex SQL queries |
| `@vivantel/virage-store-qdrant` | Qdrant (Docker or cloud) | High-scale, distributed deployments |
| `@vivantel/virage-store-chromadb` | ChromaDB (Docker or hosted) | Simple hosted deployments |

## Re-rankers

Optional post-retrieval re-rankers improve result precision by re-scoring the top-K candidates.

| Package | Requires API key | Notes |
|---------|-----------------|-------|
| `@vivantel/virage-reranker-cross-encoder` | No | Local ONNX cross-encoder; no API key required |
| `@vivantel/virage-reranker-llm` | Yes (Anthropic) | LLM-based re-ranker using claude-haiku-4-5 |

## Agent plugins

Agent plugins configure AI coding assistants to use Virage for semantic search and context retrieval. Selected during `virage init`, they are installed to the plugin dir and their `configure()` function is run to write vendor-native config files (hooks, MCP registration, slash commands).

| Package | Agent | Config written |
|---------|-------|---------------|
| `@vivantel/virage-agent-claude` | Claude Code | `.claude/skills/virage-agent/` + MCP server registration |
| `@vivantel/virage-agent-copilot` | GitHub Copilot | `.github/copilot/` (hooks.json, instructions/) |
| `@vivantel/virage-agent-codex` | OpenAI Codex | `.codex/` (hooks.json) |
| `@vivantel/virage-agent-antigravity` | Google Antigravity | `.antigravity/` (hooks.json) |

## Options

All commands accept `-v` / `-vv` / `-vvv` (up to `-vvvvv`) to increase log verbosity.

Most pipeline commands accept `-c, --config <path>` to specify a config file (default: `./virage.config.json`).

`virage dashboard` additionally accepts `--port <n>` (default: 3000) and `--verbose` (log all HTTP requests).

### Startup banner

Virage prints a one-line banner (`Virage vX.Y.Z  N chunkers · embedder · store`) on startup. To suppress it:

- **CLI flag:** `virage --no-banner <command>`
- **Environment variable:** `VIRAGE_NO_BANNER=1 virage <command>`
- **Config file:** set `"options": { "noBanner": true }` in `virage.config.json`

The banner is automatically suppressed when stdout is not a TTY (piped output, CI, etc.).
