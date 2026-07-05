# virage eval

Retrieval quality evaluation suite.

## Synopsis

```
virage eval <subcommand> [options]
virage e <subcommand> [options]
```

## Subcommands

### `virage eval run`

One-shot retrieval quality check — computes precision@5, precision@10, MRR, and hit rate against an eval dataset.

```bash
virage eval run [options]
virage e run [options]
```

### `virage eval generate` / `gen`

Generate an eval dataset from the currently indexed chunks.

```bash
virage eval generate [options]
virage e gen [options]
```

### `virage eval save --name <n>`

Run evaluation and save results under a name for later comparison.

```bash
virage eval save --name baseline
```

### `virage eval list`

List saved evaluation runs.

```bash
virage eval list
```

### `virage eval compare`

Bootstrap significance test between two saved runs.

```bash
virage eval compare --baseline <name> --candidate <name>
```

## Options (shared)

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--config <path>` | `-c` | string | `./virage.config.json` | Path to config file |

## Examples

```bash
# Generate an eval dataset and run a baseline check
virage eval generate
virage eval save --name before-update

# Update embedder, re-index, then compare
virage index --force
virage eval save --name after-update
virage eval compare --baseline before-update --candidate after-update
```

## Related

- [`virage index`](index.md) — build the index
- [`virage report`](report.md) — pipeline run observability
