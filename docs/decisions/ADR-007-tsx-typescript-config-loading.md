---
id: ADR-007
title: tsx for zero-build TypeScript config loading
status: Superseded
date: 2026-05-31
related: [ADR-035]
---

## Context

Consumer config files (`rag.config.ts`) are TypeScript. If consumers had to compile their config to JS before running the CLI, the DX would be painful. We need to load `.ts` files at runtime without requiring consumers to configure `ts-node` or Node's `--experimental-transform-types` flag.

## Decision

`loadConfig()` detects `.ts` extensions and loads them via `tsImport()` from `tsx/esm/api` (a runtime dependency). Plain `.js` configs use native `import()`. Consumers write TypeScript configs; no build step required.

## Consequences

- **+** `rag.config.ts` is ergonomic and type-safe for consumers.
- **+** Consumers get editor autocompletion on the config type.
- **−** `tsx` is a runtime dependency (not devDependency), increasing the installed footprint.
- **−** `tsx` transformation is a silent step; debugging config syntax errors can be confusing.
- **Superseded:** JSON-only config was adopted in ADR-035. `tsx` removed from runtime dependencies.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-035](./ADR-035-json-only-config.md) — supersedes this ADR; TypeScript config loading removed
