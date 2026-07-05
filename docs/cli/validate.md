# virage validate

Validate the config file against the schema without running the pipeline.

## Synopsis

```
virage validate [options]
virage val [options]
```

## Description

Loads and parses `virage.config.json`, validates it against the Zod schema, and reports any errors. Does not connect to any providers or run any pipeline stages.

Useful in CI to catch config errors early.

## Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--config <path>` | `-c` | string | `./virage.config.json` | Path to config file |

## Examples

```bash
virage validate

# Validate a non-default config
virage validate --config virage.config.ci.json
```

## Related

- [`virage check`](check.md) — validate embedder config vs stored index
- [`config.md`](config.md) — full config reference
