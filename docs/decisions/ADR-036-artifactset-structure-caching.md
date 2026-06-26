---
id: ADR-036
title: ArtifactSet structure and on-the-fly context assembly
status: Accepted
date: 2026-06-26
related: [ADR-002, ADR-037, ADR-038]
---

## Context

The original four-artifact model stored `contextText` (body + boundary padding from neighbouring windows) in the vector store so retrieval could immediately feed it to the LLM. This worked for static prompts, but in practice context formatting requirements evolve: system prompt templates change, re-ranking signals affect which neighbouring chunks to include, injection of parent section text or sibling chunks is added or removed. Storing `contextText` at index time means any such formatting change requires a full re-index.

Additionally, `contextText` duplicated most of the content already in `denseText` and `sparseText`, adding roughly 30 % to stored text volume without providing independent retrieval value.

## Decision

Remove `contextText` from stored artifacts. The stored model has three text fields (`denseText`, `sparseText`) plus an enriched `metadata` object. `contextText` is assembled on-the-fly during Level 5, Step 3 of the ranging pipeline:

1. Fetch the candidate chunk's `denseText` and `metadata`.
2. If `metadata.parentId` is set, fetch that chunk's `denseText` as a section header.
3. For each ID in `metadata.siblingIds`, fetch the neighbouring chunk's `denseText`.
4. Concatenate using the current formatting rules and pass to the LLM.

`ArtifactSet` (the output of `walkToChunks`) and `Chunk` (the virage-core interface) both drop the `contextText` field. `ChunkMeta` gains two new fields: `parentId?: string` (denseTextHash of the parent section chunk) and `siblingIds?: string[]` (denseTextHashes of adjacent chunks).

## Consequences

- **+** Context formatting experiments (prompt templates, padding heuristics) require no re-indexing.
- **+** Stored text volume reduced by approximately 30 %.
- **+** Boundary padding logic removed from chunkers, simplifying `walkToChunks`.
- **−** Slight additional latency at query time to fetch sibling/parent chunks for context assembly.
- **−** Breaking schema change: existing `.virage/lancedb` indexes and any SQLite `chunks` tables with a `context_text` column must be deleted and re-indexed.
- **−** All vector store adapters must be updated to remove `context_text`.

## Alternatives Considered

**Keep contextText, add a separate on-the-fly path:** Maintaining both would increase complexity without clear benefit — the stored `contextText` would go stale as formatting rules evolved anyway.

**Store contextText but regenerate lazily on schema change:** Adds schema-version tracking complexity across all stores. Harder to implement correctly than on-the-fly assembly.

## References

- `../virage-chunkers-ee/docs/ARCHITECTURE.md` — canonical pipeline spec
- ADR-002 — original four-stage pipeline decision
- ADR-037 — generator IDs for incremental rebuilding
