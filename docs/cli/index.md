# virage index

Run the RAG indexing pipeline — chunk, embed, and upload source files to the vector store.

## Synopsis

```
virage index [options]
virage i [options]
```

## Description

Scans the configured `fileSets`, chunks changed files, embeds them via the configured embedder, and uploads the resulting vectors to the configured vector store.

On subsequent runs only changed files (tracked via git) are re-processed. Use `--force` to rebuild everything from scratch.

## Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--config <path>` | `-c` | string | `./virage.config.json` | Path to config file |
| `--force` | `-f` | boolean | `false` | Re-embed all chunks, bypassing file-change detection and chunk-hash dedup |
| `--no-upload` | — | boolean | `false` | Embed but skip uploading to the vector store |
| `--dry-run` | — | boolean | `false` | Show what would change without writing anything |
| `--watch` | — | boolean | `false` | Re-run the pipeline on file changes |

## Output

After the progress bars complete, a summary line is printed:

```
📦 Embedded 142 chunk(s), skipped 18 (cached)
✨ RAG pipeline complete!
```

The skipped count reflects chunks whose `denseTextHash` already exists in the vector store (content-hash dedup). With `--force`, all chunks are re-embedded and the skipped count is always 0.

## Examples

```bash
# Normal incremental run
virage index

# Full rebuild
virage index --force

# Dry run to preview changes
virage index --dry-run

# Embed only, don't upload
virage index --no-upload

# Watch mode: re-index on file save
virage index --watch
```

## Pipeline tuning

Throughput and concurrency can be tuned in `virage.config.json` under the `pipeline` key. See [config.md#pipeline](config.md#pipeline).

## Related

- [`virage check`](check.md) — verify the stored index matches the current config
- [`virage validate`](validate.md) — validate config without indexing
- [`config.md`](config.md) — full config reference
