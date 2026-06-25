---
id: ADR-003
title: Consumer-implemented provider interfaces
status: Accepted
date: 2026-05-31
related: [ADR-008]
---

## Context

Different projects use different embedding providers (OpenAI, local models, GitHub Models) and different vector stores (Postgres, Pinecone, Supabase). Shipping one concrete implementation inside the core package would create tight coupling and a dependency explosion.

## Decision

Define three minimal TypeScript interfaces — `FileChunker`, `EmbeddingProvider`, `VectorStore` — that consumers implement. The core package ships no concrete implementations; it only ships the interfaces and the pipeline engine.

## Consequences

- **+** Core has zero provider-specific dependencies.
- **+** Any provider can be swapped at config time without touching the pipeline.
- **−** Getting started requires either writing an implementation or installing a companion package.
- This drove the companion package ecosystem (ADR-008).

## Alternatives Considered

[Not documented in original]

## References

- [ADR-008](./ADR-008-monorepo-independent-versioning.md) — companion package ecosystem driven by this decision
