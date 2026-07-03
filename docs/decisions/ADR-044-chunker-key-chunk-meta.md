---
id: ADR-044
title: ChunkerKey field in ChunkMeta
status: Accepted
date: 2026-07-03
related: [ADR-043, ADR-036]
---

## Context

With multiple chunkers per fileSet (ADR-043), a single file can produce chunks from different chunker packages in the same indexing run. At retrieval time, a consumer may need to know which chunker produced a given chunk — for example, to route code-graph chunks to a structured reasoning path while routing AST chunks to a dense-retrieval path.

## Decision

Add `chunkerKey?: string` to `ChunkMeta`:

```typescript
export interface ChunkMeta {
  // ...existing fields...
  chunkerKey?: string;  // npm package name of the chunker that produced this chunk
}
```

The value is set by `ChunkProcessor` to `entry.chunkerKey`, which equals the chunker's `package` field from the config. It is stored in `metadata_json` in SQLite and forwarded to the vector store's `metadata` field.

The field is optional (`?`) to allow existing indexed chunks (which predate ADR-044) to remain valid without a forced re-index.

## Consequences

- **+** Enables retrieval-time filtering by chunk producer type.
- **+** Helps consumers understand what a chunk represents without parsing its content.
- **+** Minimal cost: one extra JSON field per chunk.
- **−** Optional field means existing chunks have no `chunkerKey`; consumers must handle `undefined`.

## References

- ADR-043 — FileSets (introduces multi-chunker per fileSet)
- ADR-036 — ArtifactSet and chunk metadata structure
