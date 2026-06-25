---
id: ADR-009
title: rag.config.ts is gitignored; virage.config.ci.json is tracked
status: Accepted
date: 2026-06-01
---

## Context

`rag.config.ts` contains provider credentials (API keys via environment references), path configurations, and project-specific chunker setups. Committing it risks leaking credentials and creates merge conflicts across forks.

## Decision

Add `rag.config.ts` to `.gitignore`, treating it like `.env`. The CI-specific config (`virage.config.ci.json`) is tracked because it is infrastructure-as-code — it references published package names and no secrets directly (credentials come from GitHub Actions secrets via `${VAR}` expansion at runtime).

## Consequences

- **+** No accidental credential commits.
- **+** Each consumer's config is tailored to their project without merge friction.
- **−** New contributors must run `virage init` or manually create the config — not apparent from a `git clone`.
- Documentation in README and `virage init` mitigates this.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-011](./ADR-011-json-config-env-var-expansion.md) — `${VAR}` expansion in JSON configs
