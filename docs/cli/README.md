# virage CLI Reference

Command reference for `@vivantel/virage-cli`. For config file reference see [config.md](config.md).

## Pipeline

| Command | Alias | Description |
|---------|-------|-------------|
| [`virage index`](index.md) | `i` | Run the RAG indexing pipeline |
| [`virage check`](check.md) | `c` | Validate that the embedder config matches the stored index |
| [`virage validate`](validate.md) | `val` | Validate config file without running the pipeline |
| [`virage query <text>`](query.md) | `q` | Semantic search over the indexed knowledge base |

## Setup & lifecycle

| Command | Alias | Description |
|---------|-------|-------------|
| [`virage init`](init.md) | — | Interactive wizard: configure embedder, vector store, agents; install plugins |
| [`virage update`](update.md) | `up` | Update plugins and resync agent configs |
| [`virage install-hooks`](install-hooks.md) | `hooks` | Install git hooks for auto-indexing on pull/branch switch |
| [`virage uninstall`](uninstall.md) | `un` | Remove virage artefacts and optionally the global CLI |

## Observability & diagnostics

| Command | Alias | Description |
|---------|-------|-------------|
| [`virage report`](report.md) | `r` | Show observability report from pipeline runs |
| [`virage eval`](eval.md) | `e` | Retrieval quality evaluation suite |

## Config reference

| File | Description |
|------|-------------|
| [`config.md`](config.md) | Full `virage.config.json` field reference with types and defaults |
