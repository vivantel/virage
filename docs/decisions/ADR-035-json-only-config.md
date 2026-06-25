---
id: ADR-035
title: JSON-only config; remove TypeScript config loading
status: Accepted
date: 2026-06-02
supersedes: ADR-007
related: [ADR-011]
---

## Context

Two config formats (`virage.config.json` and `rag.config.ts`) were supported. The JSON format handles all practical use cases via `${ENV_VAR}` expansion and named built-in strategies. The TypeScript format required `tsx` as a runtime dependency, added complexity to `loadConfig()`, and was never the recommended path for CI (which always used JSON). Maintaining both added surface area without a proportional benefit.

## Decision

Remove TypeScript config loading entirely. `loadConfig()` now only handles JSON. Passing a `.ts` path raises a `ConfigError` with a migration suggestion. `tsx` is moved from `dependencies` to `devDependencies` (kept only for the `dev` watch script). The `init` command no longer offers a "TypeScript format" option.

## Consequences

- **+** Simpler `loadConfig()` — one code path, one format.
- **+** `tsx` removed from the published package's runtime dependency tree.
- **+** `init` wizard is simpler and always produces a working JSON config.
- **−** Breaking change for consumers using `rag.config.ts`. Migration: run `virage init` or rename to `.json` and convert manually.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-007](./ADR-007-tsx-typescript-config-loading.md) — superseded by this ADR
- [ADR-011](./ADR-011-json-config-env-var-expansion.md) — JSON config format that this ADR makes the sole supported format
