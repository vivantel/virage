# virage update

Update virage ecosystem packages and resync agent configurations.

## Synopsis

```
virage update [options]
virage up [options]
```

## Description

Discovers all virage packages used by the current project (embedder, vector store, re-ranker, chunkers, agent plugins), shows their current and latest versions, and installs selected updates.

After installing, `virage update` always re-runs agent plugin `configure()` to sync config files (hooks, MCP registration, slash commands) to the latest plugin version.

Self-updates the globally installed `@vivantel/virage-cli` if it is outdated.

## Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--config <path>` | `-c` | string | `./virage.config.json` | Path to config file |
| `--force` | `-f` | boolean | `false` | Pass `--force` to each `npm install` call — reinstalls even if already at latest |
| `--yes` | `-y` | boolean | `false` | Non-interactive: skip the selection checkbox and update all packages |

## Examples

```bash
# Interactive update — shows checkbox of packages to update
virage update

# Update all packages without prompting
virage update --yes

# Force-reinstall all packages (useful when a package is corrupted)
virage update --force --yes

# Only check for outdated packages (no install)
virage update --yes --dry-run  # NOTE: --dry-run not supported; use interactive mode to deselect
```

## Install locations

Packages are installed to the location where they were originally found:

| Location | Install command used |
|----------|---------------------|
| `.virage/plugins/` (local) | `npm install --prefix .virage/plugins` |
| `~/.virage/plugins/` (global) | `npm install --prefix ~/.virage/plugins` |
| `node_modules/` | project package manager (`npm`/`yarn`/`pnpm`/`bun`) |

## Related

- [`virage init`](init.md) — initial setup
- [`virage uninstall`](uninstall.md) — full removal
