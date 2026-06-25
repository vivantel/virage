---
id: ADR-011
title: JSON config format with ${VAR} environment variable expansion
status: Accepted
date: 2026-06-01
related: [ADR-035]
---

## Context

TypeScript configs (`rag.config.ts`) require `tsx` at runtime and are developer-authored. For CI environments where the embedder and vector store are always the same published packages, a JSON config is simpler to generate, validate against a schema, and diff in PRs.

## Decision

`loadConfig()` dispatches on file extension: `.json` configs go through `loadJsonConfig()`, which:

1. Validates against a known schema (required fields, strategy names, package references).
2. Resolves `${ENV_VAR}` expressions recursively via `expandEnvVars()`.
3. Dynamically imports each provider package and calls `createEmbedder(config)` / `createVectorStore(config)`.
4. Maps strategy name strings (`"markdownHeaders"`, `"token"`, etc.) via `strategy-registry.ts`.

A JSON Schema is published at `schemas/virage.config.schema.json` for editor validation.

## Consequences

- **+** CI config is declarative, schema-validated, and credential-free.
- **+** Reduces friction for non-TypeScript environments.
- **−** JSON config cannot express custom chunker logic — only built-in strategies.
- JSON became the only supported format in ADR-035; the two-format surface area was eliminated.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-035](./ADR-035-json-only-config.md) — eliminated TypeScript config, making JSON the sole format
- [ADR-009](./ADR-009-gitignore-rag-config.md) — config file gitignore policy
