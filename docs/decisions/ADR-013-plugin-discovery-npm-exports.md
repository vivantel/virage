---
id: ADR-013
title: Plugin discovery via convention-based npm package exports
status: Accepted
date: 2026-05-31
related: [ADR-011]
---

## Context

As the provider ecosystem grows, consumers should be able to reference providers by package name in their config rather than hand-writing import wiring. A lightweight discovery contract avoids a central registry.

## Decision

`discoverPlugins(packageNames)` dynamically imports each listed package and looks for `ragPlugin: RagPlugin` (single) or `ragPlugins: RagPlugin[]` (multiple) named exports. Each `RagPlugin` carries a `type` (`"embedder" | "store" | "chunker"`) and a `factory` function. Packages not following the convention emit a warning and are skipped.

## Consequences

- **+** Any npm package can become a RAG plugin with a trivial two-field export.
- **+** No central registry or peer-dependency declaration needed.
- **−** Discovery is eager (all listed packages are imported at startup).
- **−** No type-checking of plugin output; mismatched interfaces fail at runtime.
- The JSON config loader (ADR-011) uses a more explicit `createEmbedder`/`createVectorStore` contract, which is preferred for typed environments.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-011](./ADR-011-json-config-env-var-expansion.md) — JSON config uses explicit factory calls rather than discovery
