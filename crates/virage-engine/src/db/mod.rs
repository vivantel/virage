use std::collections::HashMap;
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

// ─── Schema DDL ──────────────────────────────────────────────────────────────

const SCHEMA_MIGRATIONS_DDL: &str = "
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;
";

const META_DDL: &str = "
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
";

const CHUNKS_DDL: &str = "
CREATE TABLE IF NOT EXISTS chunks (
  dense_text_hash TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  file_revision TEXT NOT NULL,
  dense_text TEXT NOT NULL,
  sparse_text TEXT NOT NULL,
  sparse_text_generator_id TEXT NOT NULL,
  metadata_generator_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  dense_vector BLOB,
  embedded_at INTEGER,
  uploaded INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS idx_chunks_source_file ON chunks(source_file);
";

const FILE_REVISIONS_DDL: &str = "
CREATE TABLE IF NOT EXISTS file_revisions (
  source_file TEXT PRIMARY KEY,
  file_revision TEXT NOT NULL
) STRICT;
";

// ─── Migrations ───────────────────────────────────────────────────────────────

type MigrationFn = fn(&Connection) -> rusqlite::Result<()>;

const MIGRATIONS: &[(u32, MigrationFn)] = &[(1, migration_v1)];

fn migration_v1(conn: &Connection) -> rusqlite::Result<()> {
    // Old-schema guard: drop chunks table if it has removed columns.
    let has_chunks: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='chunks'",
            [],
            |r| r.get::<_, u32>(0),
        )
        .map(|n| n > 0)
        .unwrap_or(false);
    if has_chunks {
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(chunks)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        if cols.iter().any(|c| c == "content" || c == "context_text") {
            conn.execute_batch(
                "DROP TABLE IF EXISTS chunks; DROP INDEX IF EXISTS idx_chunks_source_file;",
            )?;
        }
    }
    conn.execute_batch(META_DDL)?;
    conn.execute_batch(CHUNKS_DDL)?;
    conn.execute_batch(FILE_REVISIONS_DDL)?;
    Ok(())
}

fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_MIGRATIONS_DDL)?;
    for (version, up) in MIGRATIONS {
        let applied: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
                params![version],
                |r| r.get::<_, u32>(0),
            )
            .map(|n| n > 0)
            .unwrap_or(false);
        if !applied {
            up(conn)?;
            conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![version, chrono_now()],
            )?;
        }
    }
    Ok(())
}

fn chrono_now() -> String {
    // ISO-8601 timestamp without pulling in chrono crate.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Rough ISO-8601 in UTC (seconds precision is fine for migration bookkeeping).
    let y = 1970 + secs / 31_557_600;
    format!("{y}-01-01T00:00:{:02}Z", secs % 60)
}

// ─── VirageDb ────────────────────────────────────────────────────────────────

/// SQLite state store for the Virage pipeline (ADR-042).
///
/// `Connection` is `!Send`. Callers that need to use `VirageDb` from async
/// contexts should wrap calls in `tokio::task::spawn_blocking`.
pub struct VirageDb {
    conn: Connection,
}

impl VirageDb {
    /// Open (or create) the database at `path`.
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        run_migrations(&conn)?;
        Ok(Self { conn })
    }

    /// Open an in-memory database (for tests).
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        run_migrations(&conn)?;
        Ok(Self { conn })
    }

    // ── Meta ──────────────────────────────────────────────────────────────────

    pub fn get_meta_value(&self, key: &str) -> rusqlite::Result<Option<String>> {
        self.conn
            .query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
                r.get(0)
            })
            .optional()
    }

    pub fn set_meta_value(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    // ── File revisions ────────────────────────────────────────────────────────

    /// Return `source_file → file_revision` map.
    pub fn get_file_revisions(&self) -> rusqlite::Result<HashMap<String, String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT source_file, file_revision FROM file_revisions")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        rows.collect::<rusqlite::Result<HashMap<_, _>>>()
    }

    /// Set (upsert) the revision for a source file.
    pub fn set_file_revision(&self, source_file: &str, revision: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO file_revisions (source_file, file_revision) VALUES (?1, ?2)
             ON CONFLICT(source_file) DO UPDATE SET file_revision = excluded.file_revision",
            params![source_file, revision],
        )?;
        Ok(())
    }

    /// Delete a file's revision record (and its chunks).
    pub fn delete_file(&self, source_file: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "DELETE FROM chunks WHERE source_file = ?1",
            params![source_file],
        )?;
        self.conn.execute(
            "DELETE FROM file_revisions WHERE source_file = ?1",
            params![source_file],
        )?;
        Ok(())
    }

    // ── Chunks ────────────────────────────────────────────────────────────────

    /// Return `true` if a chunk with `dense_text_hash` exists.
    pub fn has(&self, dense_text_hash: &str) -> bool {
        self.conn
            .query_row(
                "SELECT 1 FROM chunks WHERE dense_text_hash = ?1",
                params![dense_text_hash],
                |_| Ok(()),
            )
            .is_ok()
    }

    /// Insert chunk metadata (no embedding yet). Ignores duplicates.
    #[allow(clippy::too_many_arguments)]
    pub fn insert_chunk(
        &self,
        dense_text_hash: &str,
        source_file: &str,
        file_revision: &str,
        dense_text: &str,
        sparse_text: &str,
        sparse_text_generator_id: &str,
        metadata_generator_id: &str,
        metadata_json: &str,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO chunks
               (dense_text_hash, source_file, file_revision, dense_text, sparse_text,
                sparse_text_generator_id, metadata_generator_id, metadata_json,
                dense_vector, embedded_at, uploaded)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, 0)",
            params![
                dense_text_hash,
                source_file,
                file_revision,
                dense_text,
                sparse_text,
                sparse_text_generator_id,
                metadata_generator_id,
                metadata_json
            ],
        )?;
        Ok(())
    }

    /// Store the dense vector blob for a chunk and mark it embedded.
    pub fn update_dense_vector(
        &self,
        dense_text_hash: &str,
        dense_vector: &[f32],
        embedded_at: i64,
    ) -> rusqlite::Result<()> {
        let blob = f32_slice_to_blob(dense_vector);
        self.conn.execute(
            "UPDATE chunks SET dense_vector = ?1, embedded_at = ?2 WHERE dense_text_hash = ?3",
            params![blob, embedded_at, dense_text_hash],
        )?;
        Ok(())
    }

    /// Mark chunks as uploaded and free the dense vector blob.
    pub fn mark_uploaded(&self, dense_text_hashes: &[&str]) -> rusqlite::Result<()> {
        if dense_text_hashes.is_empty() {
            return Ok(());
        }
        let placeholders: Vec<_> = (1..=dense_text_hashes.len())
            .map(|i| format!("?{i}"))
            .collect();
        let sql = format!(
            "UPDATE chunks SET uploaded = 1, dense_vector = NULL WHERE dense_text_hash IN ({})",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        for (i, hash) in dense_text_hashes.iter().enumerate() {
            stmt.raw_bind_parameter(i + 1, hash)?;
        }
        stmt.raw_execute()?;
        Ok(())
    }

    /// Return count of chunks pending embedding (no dense vector, not uploaded).
    pub fn pending_embed_count(&self) -> rusqlite::Result<u64> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM chunks WHERE dense_vector IS NULL AND uploaded = 0",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n as u64)
    }

    /// Return count of chunks with a dense vector, not yet uploaded.
    pub fn pending_upload_count(&self) -> rusqlite::Result<u64> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM chunks WHERE dense_vector IS NOT NULL AND uploaded = 0",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n as u64)
    }

    pub fn clear_all(&self) -> rusqlite::Result<()> {
        self.conn
            .execute_batch("DELETE FROM chunks; DELETE FROM file_revisions; DELETE FROM meta;")?;
        Ok(())
    }

    pub fn close(self) {
        drop(self.conn);
    }
}

// ─── Blob helpers ─────────────────────────────────────────────────────────────

fn f32_slice_to_blob(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for f in v {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

pub fn blob_to_f32_vec(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> VirageDb {
        VirageDb::open_in_memory().expect("open in-memory db")
    }

    #[test]
    fn open_in_memory_creates_schema() {
        let d = db();
        // Verify tables exist by querying sqlite_master
        let count: u32 = d
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('chunks', 'file_revisions', 'meta', 'schema_migrations')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 4, "all four tables should exist");
    }

    #[test]
    fn migrations_are_idempotent() {
        let d = db();
        // Run migrations again — should not fail.
        run_migrations(&d.conn).unwrap();
    }

    #[test]
    fn set_and_get_file_revision() {
        let d = db();
        d.set_file_revision("src/main.rs", "abc123").unwrap();
        d.set_file_revision("src/lib.rs", "def456").unwrap();
        let revs = d.get_file_revisions().unwrap();
        assert_eq!(revs["src/main.rs"], "abc123");
        assert_eq!(revs["src/lib.rs"], "def456");
    }

    #[test]
    fn set_file_revision_upserts() {
        let d = db();
        d.set_file_revision("src/main.rs", "v1").unwrap();
        d.set_file_revision("src/main.rs", "v2").unwrap();
        let revs = d.get_file_revisions().unwrap();
        assert_eq!(revs["src/main.rs"], "v2");
    }

    #[test]
    fn delete_removes_file_revision() {
        let d = db();
        d.set_file_revision("src/main.rs", "abc").unwrap();
        d.delete_file("src/main.rs").unwrap();
        let revs = d.get_file_revisions().unwrap();
        assert!(!revs.contains_key("src/main.rs"));
    }

    #[test]
    fn has_returns_true_for_inserted_chunk() {
        let d = db();
        d.insert_chunk(
            "hash0001",
            "src/main.rs",
            "rev1",
            "text",
            "sparse",
            "g1",
            "m1",
            "{}",
        )
        .unwrap();
        assert!(d.has("hash0001"));
        assert!(!d.has("hash9999"));
    }

    #[test]
    fn insert_chunk_is_idempotent() {
        let d = db();
        d.insert_chunk(
            "hash0001",
            "src/main.rs",
            "rev1",
            "text",
            "sparse",
            "g1",
            "m1",
            "{}",
        )
        .unwrap();
        // Second insert should be ignored (INSERT OR IGNORE).
        d.insert_chunk(
            "hash0001",
            "src/main.rs",
            "rev1",
            "text",
            "sparse",
            "g1",
            "m1",
            "{}",
        )
        .unwrap();
        let cnt: u32 = d
            .conn
            .query_row(
                "SELECT COUNT(*) FROM chunks WHERE dense_text_hash = 'hash0001'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 1);
    }

    #[test]
    fn meta_round_trip() {
        let d = db();
        d.set_meta_value("embedder", "onnx-v1").unwrap();
        assert_eq!(
            d.get_meta_value("embedder").unwrap(),
            Some("onnx-v1".to_string())
        );
        assert_eq!(d.get_meta_value("missing").unwrap(), None);
    }

    #[test]
    fn update_dense_vector_stores_blob() {
        let d = db();
        d.insert_chunk(
            "hash0001",
            "src/main.rs",
            "rev1",
            "text",
            "sparse",
            "g1",
            "m1",
            "{}",
        )
        .unwrap();
        d.update_dense_vector("hash0001", &[1.0f32, 2.0, 3.0], 12345)
            .unwrap();
        let blob: Vec<u8> = d
            .conn
            .query_row(
                "SELECT dense_vector FROM chunks WHERE dense_text_hash = 'hash0001'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let recovered = blob_to_f32_vec(&blob);
        assert_eq!(recovered, vec![1.0f32, 2.0, 3.0]);
    }

    #[test]
    fn clear_all_empties_tables() {
        let d = db();
        d.set_file_revision("src/main.rs", "rev").unwrap();
        d.insert_chunk("hash0001", "src/main.rs", "rev", "t", "s", "g", "m", "{}")
            .unwrap();
        d.clear_all().unwrap();
        assert!(d.get_file_revisions().unwrap().is_empty());
        assert!(!d.has("hash0001"));
    }

    #[test]
    fn blob_round_trip() {
        let original = vec![1.5f32, -2.3, 0.0, f32::INFINITY];
        let blob = f32_slice_to_blob(&original);
        let recovered = blob_to_f32_vec(&blob);
        assert_eq!(recovered, original);
    }
}
