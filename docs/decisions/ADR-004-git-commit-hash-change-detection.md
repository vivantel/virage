---
id: ADR-004
title: Git commit hash as the unit of change detection
status: Accepted
date: 2026-05-31
related: [ADR-005, ADR-028]
---

## Context

Re-embedding all files on every pipeline run is prohibitively expensive (API cost and latency). We need a cheap, reliable signal for "this file changed since last run."

## Decision

`GitTracker` reads the HEAD commit hash for each tracked file via `simple-git`. This hash is stored in `chunks.json` alongside the chunks it produced. On the next run, the tracker compares stored hashes against current ones — only files with a changed hash are re-processed. When there are uncommitted changes, `-dirty` is appended to the hash to force re-processing of the working-copy state.

## Consequences

- **+** Incremental runs are cheap; only genuinely changed files flow through the pipeline.
- **+** The `-dirty` suffix gives correct behavior for local development.
- **−** Requires a git repository; non-git projects cannot use this mechanism.
- **−** Renamed files appear as delete + add, not as a move, so they are fully re-embedded.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-005](./ADR-005-content-hash-embedding-skip.md) — chunk-level dedup layered on top of file-level detection
- [ADR-028](./ADR-028-branch-aware-rag.md) — extends to per-file dirty detection (replaces global dirty flag)
