# virage report

Show the observability report from recent pipeline runs.

## Synopsis

```
virage report [options]
virage r [options]
```

## Description

Reads the pipeline run log from the local database and displays a summary of recent indexing operations — files processed, chunks embedded, errors, and elapsed time.

## Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--config <path>` | `-c` | string | `./virage.config.json` | Path to config file |

## Examples

```bash
virage report
```

## Related

- [`virage index`](index.md) — run the pipeline
- [`virage eval`](eval.md) — retrieval quality evaluation
