# virage check

Validate that the current embedder configuration matches the stored index.

## Synopsis

```
virage check [options]
virage c [options]
```

## Description

Reads the stored model metadata from the local database and compares it against the current config. Exits with a non-zero status if they differ (model name or dimensions changed). Useful in CI to detect config drift before running queries.

## Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--config <path>` | `-c` | string | `./virage.config.json` | Path to config file |

## Examples

```bash
virage check
```

## Related

- [`virage validate`](validate.md) — validate the config file format
- [`virage index`](index.md) — rebuild the index when check fails
