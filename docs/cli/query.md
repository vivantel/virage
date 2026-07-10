# virage query

Semantic search over the indexed knowledge base.

## Synopsis

```
virage query <text> [options]
virage q <text> [options]
```

## Description

Searches the vector store for chunks semantically similar to `<text>`. Supports dense, sparse (BM25/FTS), and hybrid retrieval depending on the store's capabilities and the `--hybrid` flag.

Requires `virage index` to have been run first.

## Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--config <path>` | `-c` | string | `./virage.config.json` | Path to config file |
| `--top-k <n>` | — | number | `5` | Number of results to return |
| `--hybrid` | — | boolean | `false` | Enable hybrid search (dense + sparse) |
| `--min-similarity <f>` | — | float | — | Drop results below this similarity threshold (0–1) |
| `--json` | — | boolean | `false` | Output results as JSON |

**Reranking** is applied automatically when `providers.reranker` is set in the config — no extra flag needed. Results are re-scored by the cross-encoder and re-sorted before display.

## Examples

```bash
# Basic search
virage query "how does authentication work"

# Return more results as JSON
virage query "database schema" --top-k 10 --json

# Hybrid search (dense + sparse)
virage query "error handling patterns" --hybrid

# Filter out low-confidence results
virage query "auth middleware" --min-similarity 0.6
```

## Related

- [`virage index`](index.md) — build the index
- [`virage check`](check.md) — verify the index is current
