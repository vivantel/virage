---
id: ADR-006
title: Strategy pattern for chunking with createChunker composition helper
status: Superseded
date: 2026-05-31
deprecated_by: ADR-039
related: [ADR-008]
---

## Context

Chunking logic varies by file type. Markdown files benefit from header-based splitting; code files benefit from token-window splitting; YAML configs are best kept whole. We need composability without requiring every consumer to write a full `FileChunker` class.

## Decision

Split chunking into two layers:

1. **`ChunkStrategy`** — lower-level, operates on raw text (`chunk(text, filePath)`). Four built-ins: `tokenStrategy`, `markdownHeadersStrategy`, `semanticStrategy`, `wholeFileStrategy`.
2. **`FileChunker`** — higher-level, reads files from disk (`chunk(filePath, commitHash)`). Consumers typically don't implement this directly.

The `createChunker` helper bridges the two via a TypeScript discriminated union:

- **Strategy shorthand**: `createChunker({ patterns, strategy })` — wraps any `ChunkStrategy` into a `FileChunker`, auto-derives a name.
- **Custom process**: `createChunker({ name, patterns, process })` — full control, name required.

## Consequences

- **+** Most configs need only one line per file type.
- **+** Strategies are independently testable without the file-system layer.
- **+** Custom chunkers remain a first-class option without API friction.
- **−** Two-layer abstraction is a mental model cost for new contributors.
- Strategies were later extracted to `@vivantel/virage-strategies` (ADR-008).

## Alternatives Considered

[Not documented in original]

## References

- [ADR-008](./ADR-008-monorepo-independent-versioning.md) — `virage-strategies` package created as part of the monorepo split
