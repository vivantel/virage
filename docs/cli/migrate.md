# virage migrate

Migrate a v1 `virage.config.json` to v2 format in place.

## Synopsis

```
virage migrate [--config <path>]
```

## Description

`virage migrate` reads a v1 config and rewrites it to the v2 schema, then saves a
backup of the original as `<config>.bak`.

The command is safe to run on an already-v2 config — it detects the current format and
exits with a message if no migration is needed.

## v1 → v2 changes

| v1 field | v2 replacement | Notes |
|----------|----------------|-------|
| `chunking.chunkers[].package: "@vivantel/virage-chunker-ce-md"` | `fileSets[].chunkers[].package: "@vivantel/virage-chunker-ce-md"` | Move into `fileSets` |
| `chunking.chunkers[].package: "@vivantel/virage-chunker-ce-pdf"` | `fileSets[].chunkers[].package: "@vivantel/virage-chunker-ce-pdf"` | |
| `chunking.chunkers[].package: "@vivantel/virage-chunker-ce-docx"` | `fileSets[].chunkers[].package: "@vivantel/virage-chunker-ce-docx"` | |
| `chunking.chunkers[].package: "@vivantel/virage-chunker-ce-latex"` | `fileSets[].chunkers[].package: "@vivantel/virage-chunker-ce-latex"` | |
| `chunking.chunkers[].package: "@vivantel/virage-chunker-ce-lang"` | `fileSets[].chunkers[].package: "@vivantel/virage-chunker-ce-lang"` | |
| `embedder.package: "@vivantel/virage-embedder-onnx"` | `providers.embedder.package: "@vivantel/virage-embedder-onnx"` | Moved under `providers` |
| `labels` | `tags` | Field renamed |
| `labelRules` | `tagRules` | Field renamed |
| `labelFilter` | `tagFilter` | Field renamed |
| `chunking` top-level | `fileSets[]` | Replace with named file-set array |

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--config <path>` | auto-detected | Path to `virage.config.json` |

## Examples

```bash
# Migrate the config in the current directory
virage migrate

# Migrate a specific config file
virage migrate --config /path/to/virage.config.json
```

## After migration

1. Review the migrated config:
   ```bash
   cat virage.config.json
   ```
2. Validate it:
   ```bash
   virage validate
   ```
3. Re-index:
   ```bash
   virage index
   ```

The backup is at `virage.config.json.bak`. Delete it once you are satisfied with
the migrated config.

## Related

- [`virage validate`](validate.md) — validate the config after migration
- [`virage index`](index.md) — rebuild the index with the new config
- [`config.md`](config.md) — v2 config reference
