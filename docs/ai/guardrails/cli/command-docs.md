# CLI Command Docs Guardrails

These rules govern the user-facing per-command documentation in `docs/cli/`.

## Structure

Every `virage <command>` must have a corresponding `docs/cli/<command>.md`.

The config file reference lives at `docs/cli/config.md` (not a command file, but part of the same tree).

`docs/cli/README.md` is the command index — it contains a summary table of all commands.

## File template

Each `docs/cli/<command>.md` must follow this structure:

```markdown
# virage <command>

One-line description.

## Synopsis

\`\`\`
virage <command> [options]
\`\`\`

## Description

Two to four sentences explaining what the command does and when to use it.

## Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--config` | `-c` | string | `./virage.config.json` | Path to config file |
| ... | | | | |

## Examples

\`\`\`bash
virage <command>
virage <command> --flag value
\`\`\`

## Related

- [`virage <other>`](<other>.md) — why it's related
```

## Rules

1. **Scope:** one file per top-level command. Sub-commands (`virage eval run`, `virage quality bench`) live in the same parent file (e.g. `docs/cli/eval.md`), in separate `##` sections.

2. **Flags table required:** every option the command accepts must appear in the Options table. Include the flag, alias, type, default, and a one-line description. Omit flags only if the command takes no options.

3. **Keep in sync:** when adding or removing a CLI flag in `packages/virage-cli/src/`, update the corresponding `docs/cli/<command>.md` flags table in the same commit.

4. **New command:** when adding a new `virage <command>`:
   - Create `docs/cli/<command>.md` following the template above.
   - Add a row to the table in `docs/cli/README.md`.
   - Add the command to the `docs/ai/INDEX.md` Essential commands section.

5. **Config options:** pipeline tuning flags (those that mirror `pipeline.*` config keys) are documented in `docs/cli/config.md` and cross-referenced in the command file. Do not duplicate the full descriptions.

6. **No implementation details:** command docs describe behaviour observable from the CLI, not how the code works internally.
