# virage uninstall

Remove virage artefacts from the current project and optionally uninstall the global CLI.

## Synopsis

```
virage uninstall [options]
virage un [options]
```

## Description

Guides through a step-by-step cleanup of all virage-managed artefacts. Each step prompts for confirmation unless `--yes` is passed.

Cleanup steps (in order):
1. Remove virage git hooks (`post-merge`, `post-checkout`) from `.git/hooks/`
2. Remove local plugin directory (`.virage/plugins/`)
3. Remove global plugin directory (`~/.virage/plugins/`)
4. Remove embeddings database (`.virage/` directory containing LanceDB or SQLite files)
5. Remove config file (`virage.config.json`)
6. Uninstall global CLI (`npm uninstall -g @vivantel/virage-cli`)

Steps are skipped automatically if the target does not exist.

> **Warning:** step 6 removes the `virage` binary. You cannot run `virage` commands after this step completes.

## Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--yes` | `-y` | boolean | `false` | Skip all confirmation prompts and assume yes |
| `--config <path>` | `-c` | string | `./virage.config.json` | Path to config file |

## Examples

```bash
# Interactive guided cleanup
virage uninstall

# Full unattended cleanup (removes everything without prompting)
virage uninstall --yes

# Remove only project artefacts (cancel when prompted for global items)
virage uninstall
```

## Related

- [`virage init`](init.md) — set up a project
- [`virage update`](update.md) — update instead of removing
- [`virage install-hooks`](install-hooks.md) — manage git hooks independently
