---
id: ADR-020
title: virage index subcommand; help as default action
status: Accepted
date: 2026-06-03
---

## Context

Running bare `virage` executed the full pipeline silently — a poor experience for first-time users and dangerous in scripts that accidentally call the wrong binary. Other popular CLIs (git, npm, cargo) show help when called without a subcommand.

## Decision

Move the pipeline execution logic from the root program action into an explicit `index` subcommand (originally `update`, renamed for clarity). The root program's `.action()` now calls `program.outputHelp()`. All existing flags (`--force`, `--no-upload`, `--dry-run`, `--embeddings-out`, `--watch`) are unchanged, just moved under `index`. The stackable `-v` flag remains on the root program and is inherited by `index` via `program.opts()`.

## Consequences

- **+** Running `virage` with no arguments prints help — discoverable and safe.
- **+** All subcommands now follow the same `virage <command>` pattern.
- **−** Breaking change: scripts calling `virage update` must be updated to `virage index`.

## Alternatives Considered

[Not documented in original]

## References

[Not documented in original]
