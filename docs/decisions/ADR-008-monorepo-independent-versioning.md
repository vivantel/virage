---
id: ADR-008
title: Monorepo with per-package CI and independent versioning
status: Accepted
date: 2026-06-01
related: [ADR-003, ADR-016]
---

## Context

Provider implementations (embedders, vector stores) have incompatible peer dependencies (e.g. `fastembed` vs `openai` vs `@xenova/transformers`). Shipping all of them inside `rag-core` would force consumers to install every provider's dependency tree regardless of which they use.

## Decision

Convert the repository to an npm workspaces monorepo (`packages/*`). Each provider is a separate package with its own `package.json`, CI workflow, CHANGELOG, and semver version:

| Package | Role |
| --- | --- |
| `@vivantel/virage-core` | Pipeline engine + interfaces + CLI |
| `@vivantel/virage-strategies` | Built-in chunk strategies (re-export, strategies deprecated in core) |
| `@vivantel/virage-embedder-openai` | OpenAI embedding provider |
| `@vivantel/virage-embedder-fastembed` | FastEmbed (local) provider |
| `@vivantel/virage-embedder-transformers` | Hugging Face Transformers provider |
| `@vivantel/virage-store-postgres` | PostgreSQL + pgvector store |
| `@vivantel/virage-store-qdrant` | Qdrant vector store (local and cloud) |

`release-please` is configured in manifest mode to publish each package independently.

## Consequences

- **+** Consumers install only the providers they use.
- **+** Provider packages can ship breaking changes without bumping `rag-core`.
- **+** Per-package CI catches regressions in isolation.
- **−** Contributors must understand npm workspaces and cross-package build order.
- **−** `rag-core` must be built before dependent packages can type-check.
- **−** Release-please configuration is non-trivial; manifest mode required several iteration fixes.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-016](./ADR-016-automated-releases-release-please.md) — release-please configuration for this monorepo
- [ADR-030](./ADR-030-semver-ranges-peer-dependencies.md) — peerDependency strategy for inter-package dependencies
