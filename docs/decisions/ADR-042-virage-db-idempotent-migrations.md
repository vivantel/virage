---
id: ADR-042
title: VirageDb idempotent migration system
status: Accepted
date: 2026-07-03
related: [ADR-021, ADR-033]
---

## Context

The `VirageDb` constructor ran all DDL statements via `CREATE TABLE IF NOT EXISTS` on every open. Schema evolution required one-off guard code scattered in the constructor (e.g. the ad-hoc `content`/`context_text` column check at lines 219–233 that dropped the old chunks table). This approach:

1. Had no structured version tracking — you couldn't tell which schema version a DB was on.
2. Required inline guards for every schema change, which accumulated indefinitely.
3. Made deprecated entity removal ambiguous — no tracking of when removal was planned.

## Decision

Introduce a forward-only, numbered migration system in `virage-db.ts`:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;
```

All DDL is wrapped into numbered migration functions in a `MIGRATIONS` constant array:

```typescript
const MIGRATIONS: Array<{ version: number; up: (db: Database.Database) => void }> = [
  { version: 1, up: (db) => { /* all current DDL */ } },
  // future migrations appended here
];
```

The constructor calls `runMigrations()`:
1. Creates `schema_migrations` if absent.
2. Reads `MAX(version)` — 0 if empty.
3. Runs each migration whose `version > max` inside a transaction.

**No rollback support.** Deprecated columns/tables get a DDL comment marking the migration where they should be removed. New columns use nullable types to allow forward-only additive changes.

The existing `content`/`context_text` guard is removed; it is subsumed into migration 1 (the initial schema).

## Consequences

- **+** `schema_migrations` table provides a precise record of which schema is applied.
- **+** New developers and CI always get the full migration sequence.
- **+** Deprecated entities are tracked in comments with planned removal migrations.
- **−** No rollback: if a migration is wrong, a new corrective migration must be written.
- **−** Migration 1 is large (all current DDL); this is expected and intentional.

## Guardrail

See `docs/ai/guardrails/virage-db.md` for rules on when and how to write new migrations.

## References

- ADR-021 — original SQLite embeddings storage decision
- ADR-033 — `file_revisions` table (now part of migration 1)
