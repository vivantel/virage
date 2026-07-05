# CLI Output System Guardrails

These guardrails describe the conventions established by the CLI output system refactoring. Load the relevant one before modifying any CLI command or output-related file.

| I'm working on… | Load |
|-----------------|------|
| Any CLI command's output (status messages, section headers, dividers) | [`output.md`](output.md) |
| A long-running async operation in a CLI command | [`spinner.md`](spinner.md) |
| Telemetry events for CLI commands | [`telemetry.md`](telemetry.md) |
| Writing or updating user-facing command docs in `docs/cli/` | [`command-docs.md`](command-docs.md) |

## Quick rules (load the full doc for details)

- **Never** use `console.log()` for status messages — use `createOut(verbosity)` methods
- **Always** pass `verbosity: number` in command options interfaces
- **Wrap** async ops that may take >2s with `withSpinner(label, fn)`
- **Gate** CLI telemetry on `config.telemetry.enabled && config.telemetry.tiers.implicit`
- **Do not** add a spinner inside the `index` command — `PipelineRenderer` owns that
