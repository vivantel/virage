# VirageDb Migration Rules

> See ADR-042 before making any schema changes.

`VirageDb` uses a forward-only numbered migration system. The `schema_migrations` table tracks which migrations have been applied.

## Rules

### Adding a new migration

1. **Never edit an existing migration function.** Migrations run once; editing a past migration has no effect on existing databases.
2. Append a new entry to the `MIGRATIONS` array in `virage-db.ts`:
   ```typescript
   { version: N, up: (db) => {
     db.exec(`ALTER TABLE some_table ADD COLUMN new_col TEXT`);
   }},
   ```
3. Use the next sequential integer for `version`.
4. Run the migration inside the `up` function synchronously — `better-sqlite3` is sync.
5. After writing the migration, add a row to the **Migration log** section below.

### Deprecated entities

Do **not** `DROP` columns or tables immediately. Mark them with a DDL comment:

```sql
-- DEPRECATED since migration 3, planned removal in migration 5.
-- col_name TEXT NOT NULL DEFAULT ''
```

Keep the deprecated entity alive until the planned removal migration. This gives downstream consumers time to adapt.

### No rollback

Rollbacks are not supported. If a migration has a bug, write a new corrective migration (`version N+1`) that repairs the damage. Design migrations to be safe under concurrent reads (WAL mode).

### Column additions

For pure additions (no data migration needed), use `ALTER TABLE ... ADD COLUMN`:
```typescript
db.exec(`ALTER TABLE chunks ADD COLUMN new_field TEXT`);
```

SQLite requires new columns to be nullable or have a constant `DEFAULT`, which is almost always fine.

### Table additions

For new tables, use `CREATE TABLE IF NOT EXISTS` inside the migration so the migration is idempotent even if run twice due to a crash mid-transaction.

## Migration log

| Version | Date | Description |
|---|---|---|
| 1 | 2026-07-03 | Initial schema: meta, chunks, file_revisions, experiment_runs, eval_datasets, pipeline_runs, telemetry_* (6 tables), search_queries |
