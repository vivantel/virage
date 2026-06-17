# @vivantel/virage-cli

CLI for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## Installation

```bash
npm install -g @vivantel/virage-cli
# or run directly
npx @vivantel/virage-cli <command>
```

## Commands

Every top-level command has a single-key alias — use `virage --help` to see all of them.

### Pipeline

| Command | Alias | Description |
|---------|-------|-------------|
| `virage index` | `i` | Run the RAG indexing pipeline |
| `virage check` | `c` | Validate that the current embedder config matches the stored index |
| `virage validate` | `val` | Validate config without running the pipeline |
| `virage query <text>` | `q` | Semantic search over the indexed knowledge base |

### Agent integration

| Command | Alias | Description |
|---------|-------|-------------|
| `virage init` | — | Generate a `virage.config.json` template and configure agent plugins |
| `virage update` | `up` | Update all virage packages (reads `virage.config.json`; works in non-Node projects) |
| `virage install-hooks` | `hooks` | Install git hooks for auto-indexing on pull/branch switch |
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

## Options

All commands accept `-v` / `-vv` / `-vvv` (up to `-vvvvv`) to increase log verbosity.

Most pipeline commands accept `-c, --config <path>` to specify a config file (default: `./virage.config.json`).

`virage dashboard` additionally accepts `--port <n>` (default: 3000) and `--verbose` (log all HTTP requests).
