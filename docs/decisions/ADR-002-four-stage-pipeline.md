---
id: ADR-002
title: Four-stage linear pipeline architecture
status: Accepted
date: 2026-05-31
related: [ADR-010, ADR-021]
---

## Context

A RAG indexing pipeline has four natural concerns: discovering which files changed, splitting files into chunks, embedding those chunks, and syncing embeddings to a vector store. Conflating these makes each stage harder to test, profile, and skip independently.

## Decision

Implement four discrete processor classes — `GitTracker`, `ChunkProcessor`, `EmbedderProcessor`, `Uploader` — wired together by `Orchestrator`. Each stage reads/writes intermediate JSON files (`chunks.json`, `embeddings.json`) so any stage can be re-run in isolation.

## Consequences

- **+** Each stage is independently testable and replaceable.
- **+** `--no-upload` and resume capabilities are natural fall-outs of the staged design.
- **+** Per-stage telemetry is straightforward to add (see ADR-010).
- **−** Two intermediate files on disk add I/O and must be managed/cached in CI.
- **−** Orchestrator must coordinate file paths across stages; currently defaults live in `Orchestrator` constructor (`./docs/rag/chunks.json`, `./docs/rag/embeddings.json`).

## Alternatives Considered

[Not documented in original]

## References

- [ADR-010](./ADR-010-telemetry-opt-in.md) — per-stage telemetry
- [ADR-021](./ADR-021-sqlite-embeddings-storage.md) — supersedes the intermediate JSON file format
