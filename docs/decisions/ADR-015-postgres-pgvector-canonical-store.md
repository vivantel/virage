---
id: ADR-015
title: Postgres/pgvector as the canonical vector store; Supabase dropped
status: Accepted
date: 2026-06-01
---

## Context

The initial vector store implementation targeted Supabase (`rag-store-supabase`). Supabase is PostgreSQL under the hood and exposes pgvector. Managing the Supabase client SDK (auth, realtime, storage bundled) was unnecessary overhead for a backend-only vector store use case.

## Decision

Replace `@vivantel/virage-store-supabase` with `@vivantel/virage-store-postgres`, which connects directly to PostgreSQL via `pg` + `pgvector`. The new package exposes `createVectorStore(config)` compatible with the JSON config format (ADR-011). Connection details are passed via environment variables expanded at load time.

## Consequences

- **+** Direct Postgres connection is simpler, lighter, and works with any Postgres host (self-hosted, RDS, Supabase, Neon, etc.).
- **+** Removes the Supabase SDK from the dependency tree.
- **−** Supabase-specific features (Row Level Security policies, realtime subscriptions) are no longer available.
- **−** Existing deployments using `rag-store-supabase` must migrate.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-011](./ADR-011-json-config-env-var-expansion.md) — JSON config format used by this store
