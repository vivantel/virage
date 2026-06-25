---
id: ADR-022
title: Mid-run partial uploads via onIntermediateBatch callback
status: Accepted
date: 2026-06-03
related: [ADR-021]
---

## Context

Before this change, the upload stage ran only after all embeddings were complete. For large corpora, this meant the vector store was empty until the very end of the run, and a failure during upload (after a long embedding stage) would require re-uploading everything. The SQLite `uploaded` flag (ADR-021) made it possible to upload a batch mid-run and record exactly which chunks had been delivered.

## Decision

`EmbedderProcessor.run()` accepts an optional `onIntermediateBatch?: () => Promise<void>` callback and a `minIngestionBatchSize` constructor option (default `Infinity` — disabled). After each timed save, if `db.pendingCount() >= minIngestionBatchSize`, the callback is invoked. The orchestrator wires this to:

```typescript
async () => {
  await uploader.uploadPending(db);
};
```

`uploadPending(db)` uploads only pending rows (no delta check against the vector store, no delete phase) and calls `db.markUploaded(contentHashes)` after each batch.

`minIngestionBatchSize` is exposed as a first-class option in `RAGPipelineConfig.options` and in the JSON config schema.

## Consequences

- **+** The vector store is populated incrementally — useful for long embedding runs and for monitoring progress in real time.
- **+** A failure late in the run only requires re-uploading the remaining pending chunk, not re-uploading everything.
- **+** Configurable threshold means the feature is off by default and can be tuned per corpus size.
- **−** `uploadPending` skips the delta check, so intermediate uploads are always upserts with no corresponding delete. Files being re-indexed from a changed commit will have their old chunks in the store until the final `sync()` delete sweep runs at the end of the pipeline.
- **−** If `skipUpload` is set, the intermediate callback is suppressed entirely; the threshold has no effect.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-021](./ADR-021-sqlite-embeddings-storage.md) — SQLite `uploaded` flag that makes this possible
