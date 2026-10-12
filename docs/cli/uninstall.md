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
2. Remove virage's host registrations (one confirmation, only shown if any exist):
   - the `virage` entry (and the older `virage-agent` name) from `.mcp.json`
   - the hook older versions wrote to `.claude/settings.json` (the `inject-context` `UserPromptSubmit` hook, and any hook carrying virage's `[Virage]` marker)
   - the retrieval declaration `.go-getter/retrieval/virage.json`
3. Remove local plugin directory (`.virage/plugins/`)
4. Remove global plugin directory (`~/.virage/plugins/`)
5. Remove embeddings database (`.virage/` directory containing LanceDB or SQLite files)
6. Remove config file (`virage.config.json`)
7. Uninstall global CLI (`npm uninstall -g @vivantel/virage-cli`)

Steps are skipped automatically if the target does not exist.

Step 2 touches only virage's own entries: every other MCP server, hook and setting is kept, in its original order. A file that cannot be parsed is left untouched with a warning, and running the command again after the entries are gone changes nothing. The retrieval files owned by go-getter (`.go-getter/retrieval/policy.json`, other tools' declarations) are never touched.

> **Warning:** step 7 removes the `virage` binary. You cannot run `virage` commands after this step completes.

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
