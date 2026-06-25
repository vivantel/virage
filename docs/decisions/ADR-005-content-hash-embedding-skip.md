---
id: ADR-005
title: Content hash for embedding-layer incremental skip
status: Accepted
date: 2026-05-31
related: [ADR-004, ADR-021]
---

## Context

File-level commit hashes (ADR-004) detect file changes, but a single file produces multiple chunks. If a file changes but only some chunks are modified, we would still re-embed all chunks from that file.

## Decision

`ChunkProcessor` computes a `contentHash` (SHA-256, first 16 hex chars) for each chunk's text. `EmbedderProcessor` skips any chunk whose `contentHash` already exists in `embeddings.json`, regardless of the file-level commit hash.

## Consequences

- **+** Embedding is idempotent: re-running on an unchanged chunk is a no-op.
- **+** Cheap insurance against partial failures — a crashed run resumes from the last checkpoint.
- **−** Content-hash comparisons happen in-memory against the full `embeddings.json`; very large embedding files could add startup latency.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-004](./ADR-004-git-commit-hash-change-detection.md) — file-level change detection
- [ADR-021](./ADR-021-sqlite-embeddings-storage.md) — supersedes the in-memory JSON approach with SQLite row-level tracking
