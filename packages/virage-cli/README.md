# @vivantel/virage-cli

CLI for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## Installation

```bash
npm install -g @vivantel/virage-cli
# or run directly
npx @vivantel/virage-cli <command>
```

## Commands

### Pipeline

| Command | Description |
|---------|-------------|
| `virage index` | Run the RAG indexing pipeline |
| `virage check` | Validate that the current embedder config matches the stored index |
| `virage validate` | Validate config without running the pipeline |

### Agent integration

| Command | Description |
|---------|-------------|
| `virage init` | Generate a `virage.config.json` template and configure agent plugins |
| `virage update` | Update virage ecosystem packages and re-sync agent plugin config files |
| `virage usage` | Print per-prompt token usage for the current Claude Code session (zero inference tokens) |

### Evaluation

| Command | Description |
|---------|-------------|
| `virage evaluate` | Evaluate retrieval quality against an eval dataset |
| `virage eval-generate` | Generate an eval dataset from existing chunks |
| `virage experiment run` | Run an experiment and save results |
| `virage experiment list` | List saved experiment runs |
| `virage experiment compare` | Compare two experiment runs with bootstrap significance test |
| `virage report` | Show observability report from pipeline runs |

### Diagnostics

| Command | Description |
|---------|-------------|
| `virage store stats` | Show vector index quality metrics |
| `virage store perf` | Show query performance report |
| `virage benchmark embedder` | Benchmark embedder latency and throughput |
| `virage chunks report` | Show chunk cohesion report |
| `virage viz embeddings` | Generate a 2D visualization of the embedding space |
| `virage dashboard` | Start a local RAG monitoring dashboard |

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
