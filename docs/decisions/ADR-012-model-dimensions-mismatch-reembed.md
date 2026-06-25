---
id: ADR-012
title: Model + dimensions mismatch triggers automatic full re-embed
status: Accepted
date: 2026-06-01
---

## Context

If the embedding model changes between runs, all cached embeddings are invalid — vectors from different models are not comparable. Manual cache invalidation is error-prone.

## Decision

`embeddings.json` stores a `_meta` header (`EmbeddingsMeta`) with `model`, `providerDimensions`, `providerName`, `vectorStoreName`, `createdAt`, and `updatedAt`. On startup, `EmbedderProcessor` compares the current provider's model and dimensions against `_meta`:

- **Model or dimensions changed** → clear all embeddings, force full re-embed (loud warning to stdout).
- **Provider name changed but model/dimensions unchanged** → no invalidation (same model via OpenAI vs Azure vs GitHub Models produces identical vectors).
- **Vector store name changed** → `Uploader` forces a full re-upload on the next run.

Legacy `embeddings.json` files (bare arrays, no `_meta`) are read transparently via `embeddings-io.ts`.

## Consequences

- **+** Prevents silent vector corruption when switching models.
- **+** Provider name changes (e.g. OpenAI → Azure OpenAI, same model) do not wastefully re-embed.
- **+** Backwards compatible with existing `embeddings.json` files.
- **−** Adds a startup read of `embeddings.json` to compare metadata before processing begins.

## Alternatives Considered

[Not documented in original]

## References

[Not documented in original]
