---
id: ADR-014
title: Standalone CI workflow consuming published npm packages
status: Accepted
date: 2026-06-01
---

## Context

Running the RAG update pipeline in CI used to build `rag-core` from source as part of the same job. After the monorepo restructure, the source layout changed and build ordering became fragile. Additionally, "run the RAG pipeline on docs" is a content-update concern, not a library-build concern.

## Decision

Extract the RAG pipeline into a dedicated workflow (`.github/workflows/virage.yaml`) that:

1. Installs `@vivantel/virage-core` and companion packages from the published npm registry (not from source).
2. Uses `virage.config.ci.json` (tracked, schema-validated).
3. Caches `docs/rag/chunks.json` and `docs/rag/embeddings.json` via `actions/cache` to make incremental runs fast.
4. Triggers only on pushes to `master`.

## Consequences

- **+** Decouples RAG pipeline health from library CI; each can fail independently.
- **+** CI config is pinned to released versions, not to whatever is on `master`.
- **+** Contributors don't need to build the library to run the pipeline locally.
- **−** A library change doesn't take effect in the RAG workflow until it's released and the workflow's dependency is updated.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-009](./ADR-009-gitignore-rag-config.md) — `virage.config.ci.json` tracking policy
