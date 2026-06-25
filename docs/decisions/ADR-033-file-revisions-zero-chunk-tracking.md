---
id: ADR-033
title: file_revisions table for zero-chunk file tracking
status: Accepted
date: 2026-06-20
related: [ADR-021]
---

## Context

`getFileStates()` in `VirageDb` returns a `Map<filePath, gitBlobSha>` by querying `chunks GROUP BY source_file`. This means only files that produced at least one chunk are present in the map. Files that are valid and tracked but yield zero chunks (e.g. short config files, `vitest.config.ts`, `CLAUDE.md`) are silently absent. On every subsequent `virage index` run, `getChangedFiles()` finds them absent from `previousState` and marks them as `🆕 New`, re-chunking them unconditionally even though their content hasn't changed.

## Decision

Add a dedicated `file_revisions` table to `virage.db`:

```sql
CREATE TABLE IF NOT EXISTS file_revisions (
  source_file TEXT PRIMARY KEY,
  file_revision TEXT NOT NULL
) STRICT;
```

`replaceChunks(sourceFile, chunks, fileRevision?)` upserts into this table unconditionally. `deleteBySourceFile` deletes from both `chunks` and `file_revisions` to keep them in sync.

`getFileStates()` seeds the result map from `chunks GROUP BY source_file` (backward compat for existing DBs) then overlays entries from `file_revisions`, which takes precedence and covers zero-chunk files.

The orchestrator passes `info.commitHash` as the third argument so zero-chunk files are recorded in `file_revisions` after processing.

## Consequences

- **+** Files that produce zero chunks are tracked after the first index run and not re-processed on subsequent runs.
- **+** Backward compatible: existing DBs without `file_revisions` fall back to the `chunks` query; `CREATE TABLE IF NOT EXISTS` is idempotent.
- **+** `replaceChunks` third parameter is optional — all existing call sites still work.
- **−** Slightly more storage: one row per tracked file in `file_revisions` on top of existing `chunks` rows.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-021](./ADR-021-sqlite-embeddings-storage.md) — SQLite schema that this table extends
