---
id: ADR-023
title: Fail-fast on fatal vector store errors; skip retries
status: Accepted
date: 2026-06-03
---

## Context

The retry loop in `Uploader` treated all errors as transient. Schema mismatches (e.g. the LanceDB "Schema Error: Provided schema does not match existing table schema") and authentication failures are deterministic — they will not succeed on any subsequent attempt. Retrying them wastes time and obscures the real error.

## Decision

Introduce `isFatalVectorStoreError(err: unknown): boolean` in `uploader.ts`:

```typescript
const msg = String(err instanceof Error ? err.message : err).toLowerCase();
return /schema error|schema mismatch|unauthorized|authentication failed/.test(msg);
```

All `withRetry` calls in `Uploader` (both `sync()` and `uploadPending()`) now pass `isRetryable: (err) => !isFatalVectorStoreError(err)`. A fatal error causes `withRetry` to rethrow immediately, skipping all remaining retry attempts.

The LanceDB "Schema Error" root cause was also fixed independently: `LanceDBVectorStore.initialize()` now uses an explicit open-or-create pattern (`tableNames()` → `openTable` or `createEmptyTable`) instead of `createEmptyTable(..., { existOk: true })`, which was triggering Arrow schema validation on every second run.

## Consequences

- **+** Schema and auth errors surface immediately with the full error message, rather than failing after the retry budget is exhausted.
- **+** Removes spurious wait time (retry back-off intervals) for unrecoverable failures.
- **+** LanceDB specifically no longer throws on the second run; the fail-fast path is a safety net for the general case.
- **−** Error classification is regex-based on message strings. Provider-specific error messages that don't match the pattern will still be retried unnecessarily; the pattern may need expanding as new store implementations are added.

## Alternatives Considered

[Not documented in original]

## References

[Not documented in original]
