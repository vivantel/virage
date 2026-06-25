---
id: ADR-024
title: Split virage-core into library + CLI + dashboard packages
status: Accepted
date: 2026-06-09
related: [ADR-008]
---

## Context

`@vivantel/virage-core` bundled pure business logic (orchestrator, chunkers, embedders, eval framework, SQLite storage) together with CLI-only code (commander, cli-progress, @inquirer/prompts, consola, dotenv, all command handlers). Library consumers were forced to install all CLI dependencies even when using virage-core programmatically. The embedded HTML template in `cli/dashboard.ts` also limited UI complexity.

## Decision

1. **`@vivantel/virage-core`** remains the library package (same npm name, no breaking rename). CLI deps (`commander`, `cli-progress`, `@inquirer/prompts`, `consola`, `dotenv`) removed. The `bin` field removed.

2. **`@vivantel/virage-cli`** is a new published package providing the `virage` binary. It depends on `@vivantel/virage-core` and holds all CLI command handlers, logger implementations, and the progress bar wrapper.

3. **`@vivantel/virage-dashboard`** is a new private React + Vite web app served by `virage dashboard`. The HTTP API (three JSON endpoints) is in `virage-cli`; the React app is built separately and embedded.

4. **Orchestrator progress reporting** changed from internal `createProgressBar` calls to optional `onChunkProgress`, `onEmbedProgress`, `onUploadProgress` callbacks in `RAGPipelineConfig.options`. The CLI layer creates bars and passes them; library consumers ignore them.

5. **`IGNORED_DIRS`** moved from `cli/file-detect.ts` to `core/virage-defaults.ts` so `GitTracker` (business logic) can import it without a circular dep.

## Consequences

- **+** Library consumers can install `@vivantel/virage-core` with ~5 fewer transitive deps.
- **+** React dashboard can be developed independently and has proper component structure.
- **+** Orchestrator is now testable without any CLI dep mocking.
- **−** Users who install `@vivantel/virage-core` for the `virage` binary must now also install `@vivantel/virage-cli`. Documentation update required.
- **−** Build order must ensure virage-core is built before virage-cli (npm workspaces handles this via the declared dependency).

## Alternatives Considered

[Not documented in original]

## References

- [ADR-008](./ADR-008-monorepo-independent-versioning.md) — monorepo structure this split extends
