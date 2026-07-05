# virage install-hooks

Install (or remove) git lifecycle hooks for automatic indexing.

## Synopsis

```
virage install-hooks [options]
virage hooks [options]
```

## Description

Installs `post-merge` and `post-checkout` hooks in `.git/hooks/` so that `virage index` runs automatically after every `git pull` or branch switch.

The hooks are appended to any existing hook file using a marker comment (`# Added by virage install-hooks`) so existing hook content is preserved. When uninstalling, only the virage-added block is removed.

## Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--uninstall` | — | boolean | `false` | Remove virage-added hooks instead of installing |
| `--git-dir <path>` | — | string | `./.git` | Path to the `.git` directory |

## Examples

```bash
# Install hooks
virage install-hooks

# Remove hooks
virage install-hooks --uninstall

# Use a non-standard git directory
virage install-hooks --git-dir /path/to/.git
```

## Related

- [`virage uninstall`](uninstall.md) — full cleanup including hooks
- [`virage init`](init.md) — `virage init` offers to install hooks
