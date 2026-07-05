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
| `--top-k <n>` | `-k` | number | `5` | Number of results to return |
| `--hybrid` | — | boolean | config value | Enable hybrid search (dense + sparse) |
| `--rerank` | — | boolean | `false` | Re-rank results with the configured re-ranker |
| `--json` | — | boolean | `false` | Output results as JSON |
| `--branch <name>` | — | string | current branch | Filter results by git branch |

## Examples

```bash
# Basic search
virage query "how does authentication work"

# Return more results as JSON
virage query "database schema" --top-k 10 --json

# Hybrid search with re-ranking
virage query "error handling patterns" --hybrid --rerank
```

## Related

- [`virage index`](index.md) — build the index
- [`virage check`](check.md) — verify the index is current
