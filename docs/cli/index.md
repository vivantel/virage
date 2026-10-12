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

If `.go-getter/retrieval/policy.json` exists (or [conformance mode](config.md#retrieval) is on), it is read before every run: its `ignore` globs apply on top of `fileSets` include/ignore, and an embedder the policy does not allow is refused. See [index policy](config.md#index-policy).

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

## Metadata fields requiring re-index

Some `ChunkMeta`/`DocNodeAttrs` fields are additive — they populate only on chunks processed after
the change that introduced them ships. Chunks already in the vector store keep whatever the pipeline
knew when they were indexed and won't gain the new field until re-embedded. Use `virage index --force`
to backfill them across an existing index.

Currently additive in this sense: `citation` (chunker-owned override — xlsx cell refs, pptx
slide/shape refs; see IR-048) and `lineStart`/`lineEnd` on chunkers not yet backfilled (PDF, DOCX,
LaTeX as of this writing — Markdown and tree-sitter already populate them).

## Pipeline tuning

Throughput and concurrency can be tuned in `virage.config.json` under the `pipeline` key. See [config.md#pipeline](config.md#pipeline).

## Related

- [`virage check`](check.md) — verify the stored index matches the current config
- [`virage validate`](validate.md) — validate config without indexing
- [`config.md`](config.md) — full config reference
