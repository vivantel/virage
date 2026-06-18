# Virage DB — Direct SQLite Queries

Use with: `sqlite3 .virage/virage.db '<query>'`

The DB schema uses `STRICT` mode.

```sql
-- chunk count
SELECT COUNT(*) FROM chunks;

-- pending embed count
SELECT COUNT(*) FROM chunks WHERE embedding IS NULL;

-- pending upload count
SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL AND uploaded = 0;

-- file list with chunk counts
SELECT source_file, COUNT(*) AS chunks FROM chunks GROUP BY source_file;
```
