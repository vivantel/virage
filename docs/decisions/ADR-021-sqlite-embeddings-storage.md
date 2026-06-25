---
id: ADR-021
title: SQLite as intermediate embeddings storage, replacing monolithic JSON
status: Accepted
date: 2026-06-03
supersedes: ADR-002
related: [ADR-022, ADR-005]
---

## Context

`embeddings.json` was a monolithic file that was fully read and rewritten on every save. This created three problems:

1. **Re-embed bug on partial runs**: the file tracked only final embeddings, with no distinction between "embedded but not yet uploaded" and "embedded and uploaded". When a run embedded some chunks and uploaded them, then was interrupted before finishing, the next run couldn't tell which chunks were already in the vector store and would re-embed them from scratch.
2. **Full read-merge-write on every batch save**: even a small incremental batch triggered a full JSON parse, in-memory merge, and full-file serialise/write cycle — O(n) in total embedding count, every time.
3. **No streaming ingestion**: there was no way to upload a batch to the vector store while later batches were still being embedded.

## Decision

Replace `embeddings.json` with an SQLite database (`embeddings.db`, derived by substituting the extension). The `EmbeddingsDb` class wraps `better-sqlite3` (synchronous API) and owns the full storage contract:

- Each row tracks `content_hash`, source/commit/content/metadata/embedding fields, and an `uploaded INTEGER` flag (`0` = pending, `1` = uploaded to vector store).
- `EmbeddingsMeta` is stored in a separate `meta` table as a single JSON value.
- On first construction, if the database is empty and a sibling `.json` file exists, `EmbeddingsDb` auto-migrates the JSON, marking migrated rows as `uploaded = 1` (they were already synced), then renames the JSON to `.json.migrated`.

The `Orchestrator` derives the db path from `embeddingsFile` (`foo/embeddings.json` → `foo/embeddings.db`), constructs one `EmbeddingsDb` instance, and passes it to both `EmbedderProcessor` and `Uploader`. The db is closed in a `finally` block at the end of `run()`.

## Consequences

- **+** Re-embed bug fixed: `getChunksToEmbed` reads `db.getAll()` (pending + uploaded) for skip detection, so already-uploaded chunks are never re-embedded after a partial run.
- **+** Saves are atomic row inserts via a SQLite transaction; no read-merge-write cycle.
- **+** `uploaded` flag enables `getPending()`, `markUploaded()`, and `uploadPending()` — the building blocks for intermediate batch ingestion (ADR-022).
- **+** WAL journal mode allows concurrent reads during writes.
- **−** `better-sqlite3` is a native module (compiled via node-gyp). It must be rebuilt when switching Node.js ABI versions; pre-built binaries are downloaded by `prebuild-install` on supported platforms.
- **−** The intermediate artifact is now a binary `.db` file rather than a human-readable `.json`. Inspecting it requires a SQLite tool.
- **−** Migration from JSON is one-way; once the `.json` is renamed to `.json.migrated`, only SQLite is used.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-022](./ADR-022-mid-run-partial-uploads.md) — mid-run batch uploads enabled by the `uploaded` flag
- [ADR-005](./ADR-005-content-hash-embedding-skip.md) — content-hash skip mechanism superseded by SQLite row-level tracking
