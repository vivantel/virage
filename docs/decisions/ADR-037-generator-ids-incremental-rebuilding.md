---
id: ADR-037
title: Per-chunk generator IDs for incremental rebuilding
status: Accepted
date: 2026-06-26
related: [ADR-036, ADR-005, ADR-038]
---

## Context

The original caching model used two session-level keys stored in the `meta` table:

- `sparseTextId` — `${name}@${version}:sparse:${optsFp}` — if unchanged from last run, skip FTS rebuild.
- `contextTextHash` — `${name}@${version}:ctx:${optsFp}` — if unchanged, skip context refresh.

These keys were identical for every chunk produced in a single session, because there was only one chunker configuration per session. This made them unable to differentiate between filesets served by different chunker configurations in the same pipeline run (e.g., `.md` files chunked with overlap=0.15 and `.ts` files with overlap=0).

Additionally, `contextTextHash` tracked context generation parameters that are no longer relevant after ADR-036 removed stored `contextText`.

## Decision

Introduce `sparseTextGeneratorId` and `metadataGeneratorId` as **per-chunk stored fields** in both `ArtifactSet` and the `chunks` SQLite table. They are method fingerprints, not content fingerprints.

**Distinction:**
- `denseTextHash` is a *content fingerprint* — it changes when the chunk text changes.
- `sparseTextGeneratorId` is a *method fingerprint* — it changes when the sparse-text generation methodology changes (e.g., different overlap, different stop-word list), not when content changes.
- `metadataGeneratorId` is a *method fingerprint* — it changes when the metadata assembly methodology changes (e.g., NER or FQN extraction is enabled or disabled, a new metadata field is added).

**Computation:** Each chunker computes these IDs once per instance from its name, version, and configuration fingerprint:
```
sparseTextGeneratorId = sha256(`${name}@${version}:sparse:${JSON.stringify(opts)}`).slice(0,16)
metadataGeneratorId   = sha256(`${name}@${version}:meta:${JSON.stringify(opts)}`).slice(0,16)
```

**Incremental rebuilding:** On a subsequent run, the pipeline compares each chunk's stored generator ID with the currently running chunker's generator ID:
- If `sparseTextGeneratorId` differs → re-generate `sparseText` for that chunk and rebuild the FTS index for the affected fileset.
- If `metadataGeneratorId` differs → re-enrich `metadata` for that chunk.
- `denseTextHash` is unchanged → no re-embedding needed (content is the same).

Because these IDs are stored per-chunk rather than per-session, a single pipeline run that covers multiple filesets with different configurations can identify and rebuild only the affected chunks.

## Consequences

- **+** Supports heterogeneous pipelines with per-fileset chunker configurations.
- **+** Targeted incremental rebuilds: only the affected artifact (sparseText or metadata) is regenerated, not the full chunk.
- **+** `denseVector` is preserved when only the method changes — no re-embedding cost.
- **−** Two additional columns per row in the `chunks` SQLite table (`sparse_text_generator_id`, `metadata_generator_id`).
- **−** Breaking schema change: existing `chunks` tables without these columns must be dropped and re-indexed (handled by old-schema detection in `VirageDb`).

## Alternatives Considered

**Keep session-level keys in `meta` table:** Cannot support per-fileset differentiation. No per-chunk granularity.

**Store generator IDs only in chunk metadata JSON:** Harder to query and index. The SQLite/vector-store columns allow efficient batch queries for "all chunks with old generator ID."

## References

- `../virage-chunkers-ee/docs/ARCHITECTURE.md` — canonical pipeline spec
- ADR-005 — content hash embedding skip (complementary per-chunk cache)
- ADR-036 — ArtifactSet structure (removes contextTextHash)
