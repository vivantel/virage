---
id: ADR-019
title: @vivantel/virage-store-test private workspace package
status: Accepted
date: 2026-06-03
related: [ADR-018]
---

## Context

The acceptance tests needed a `VectorStore` implementation that persists state to a local JSON file so the full pipeline can run without a real database. The implementation lived in `scripts/test-store.mjs` and was referenced by an absolute file path in `vectorStore.package` — fragile and not resolvable by the standard `import()` mechanism used by `loadConfig()`.

## Decision

Promote the implementation to a private TypeScript workspace package `@vivantel/virage-store-test`. The config references it as `"package": "@vivantel/virage-store-test"` and the npm workspace symlink resolves it correctly. The package deliberately has no `rag-plugin` field so it is not auto-discovered by `loadRegistry()`. It fully implements `VectorStore` including `getIndexStats()` and `getQueryPerfReport()` (returning stub zeroes).

## Consequences

- **+** Config uses a clean package name rather than a fragile absolute path.
- **+** Type-safe TypeScript implementation; peer-depends on `@vivantel/virage-core` for the interface types.
- **+** No risk of accidental production use (no `rag-plugin` field, `private: true`).
- **−** One additional package to build before running acceptance tests.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-018](./ADR-018-vitest-acceptance-test-suite.md) — acceptance test suite that uses this package
