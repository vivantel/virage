use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use serde_json::Value;
use sqlx::{AssertSqlSafe, PgPool};

use super::{SearchOptions, SearchResult, VectorDocument, VectorStore};

// ─── PostgresStore ────────────────────────────────────────────────────────────

pub struct PostgresStore {
    connection_string: String,
    table: String,
    dimensions: usize,
    pool: tokio::sync::RwLock<Option<PgPool>>,
}

impl PostgresStore {
    pub fn new(
        connection_string: impl Into<String>,
        table: impl Into<String>,
        dimensions: usize,
    ) -> Self {
        Self {
            connection_string: connection_string.into(),
            table: table.into(),
            dimensions,
            pool: tokio::sync::RwLock::new(None),
        }
    }

    async fn get_pool(&self) -> anyhow::Result<PgPool> {
        self.pool
            .read()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("PostgresStore: call initialize() first"))
    }

    fn vec_to_sql(v: &[f32]) -> String {
        let inner = v
            .iter()
            .map(|f| f.to_string())
            .collect::<Vec<_>>()
            .join(",");
        format!("[{inner}]")
    }
}

#[async_trait]
impl VectorStore for PostgresStore {
    async fn initialize(&self) -> anyhow::Result<()> {
        let pool = PgPool::connect(&self.connection_string).await?;
        let dims = self.dimensions;
        let table = &self.table;

        sqlx::query("CREATE EXTENSION IF NOT EXISTS vector")
            .execute(&pool)
            .await?;

        // Old-schema guard: drop table if it has outdated columns.
        let old_cols: Vec<String> = sqlx::query_scalar(
            "SELECT column_name FROM information_schema.columns \
             WHERE table_name = $1 AND column_name IN ('content', 'context_text')",
        )
        .bind(table)
        .fetch_all(&pool)
        .await?;
        if !old_cols.is_empty() {
            sqlx::query(AssertSqlSafe(format!("DROP TABLE IF EXISTS {table}")))
                .execute(&pool)
                .await?;
        }

        sqlx::query(AssertSqlSafe(format!(
            "CREATE TABLE IF NOT EXISTS {table} (
                id TEXT PRIMARY KEY,
                dense_text TEXT NOT NULL,
                sparse_text TEXT NOT NULL,
                dense_text_hash TEXT NOT NULL,
                sparse_text_generator_id TEXT NOT NULL,
                metadata_generator_id TEXT NOT NULL,
                dense_vector vector({dims}) NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{{}}',
                source_file TEXT NOT NULL,
                commit_hash TEXT NOT NULL
            )"
        )))
        .execute(&pool)
        .await?;

        sqlx::query(AssertSqlSafe(format!(
            "CREATE INDEX IF NOT EXISTS {table}_source_file_idx ON {table}(source_file)"
        )))
        .execute(&pool)
        .await?;

        *self.pool.write().await = Some(pool);
        Ok(())
    }

    async fn upsert(&self, docs: &[VectorDocument]) -> anyhow::Result<()> {
        if docs.is_empty() {
            return Ok(());
        }
        let pool = self.get_pool().await?;
        let table = &self.table;
        for doc in docs {
            let vec_sql = Self::vec_to_sql(&doc.dense_vector);
            let meta_json = serde_json::to_string(&doc.metadata)?;
            sqlx::query(AssertSqlSafe(format!(
                "INSERT INTO {table}
                    (id, dense_text, sparse_text, dense_text_hash,
                     sparse_text_generator_id, metadata_generator_id,
                     dense_vector, metadata_json, source_file, commit_hash)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9, $10)
                 ON CONFLICT (id) DO UPDATE SET
                     dense_text = EXCLUDED.dense_text,
                     sparse_text = EXCLUDED.sparse_text,
                     dense_text_hash = EXCLUDED.dense_text_hash,
                     sparse_text_generator_id = EXCLUDED.sparse_text_generator_id,
                     metadata_generator_id = EXCLUDED.metadata_generator_id,
                     dense_vector = EXCLUDED.dense_vector,
                     metadata_json = EXCLUDED.metadata_json,
                     source_file = EXCLUDED.source_file,
                     commit_hash = EXCLUDED.commit_hash"
            )))
            .bind(&doc.id)
            .bind(&doc.dense_text)
            .bind(&doc.sparse_text)
            .bind(&doc.dense_text_hash)
            .bind(&doc.sparse_text_generator_id)
            .bind(&doc.metadata_generator_id)
            .bind(&vec_sql)
            .bind(&meta_json)
            .bind(&doc.source_file)
            .bind(&doc.commit_hash)
            .execute(&pool)
            .await?;
        }
        Ok(())
    }

    async fn delete_by_source(&self, files: &[&str]) -> anyhow::Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let pool = self.get_pool().await?;
        let table = &self.table;
        let list = files
            .iter()
            .map(|f| format!("'{}'", f.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join(", ");
        sqlx::query(AssertSqlSafe(format!(
            "DELETE FROM {table} WHERE source_file IN ({list})"
        )))
        .execute(&pool)
        .await?;
        Ok(())
    }

    async fn existing_hashes(&self, hashes: &[&str]) -> anyhow::Result<HashSet<String>> {
        if hashes.is_empty() {
            return Ok(HashSet::new());
        }
        let pool = self.get_pool().await?;
        let table = &self.table;
        let list = hashes
            .iter()
            .map(|h| format!("'{}'", h.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join(", ");
        let rows: Vec<String> = sqlx::query_scalar(AssertSqlSafe(format!(
            "SELECT id FROM {table} WHERE id IN ({list})"
        )))
        .fetch_all(&pool)
        .await?;
        Ok(rows.into_iter().collect())
    }

    async fn current_state(&self) -> anyhow::Result<HashMap<String, String>> {
        let pool = self.get_pool().await?;
        let table = &self.table;
        let rows: Vec<(String, String)> = sqlx::query_as(AssertSqlSafe(format!(
            "SELECT source_file, commit_hash FROM {table}"
        )))
        .fetch_all(&pool)
        .await?;
        Ok(rows.into_iter().collect())
    }

    async fn search(
        &self,
        query: &[f32],
        top_k: usize,
        _opts: SearchOptions,
    ) -> anyhow::Result<Vec<SearchResult>> {
        let pool = self.get_pool().await?;
        let table = &self.table;
        let vec_sql = Self::vec_to_sql(query);

        // cosine distance: 1 - similarity => similarity = 1 - distance
        let rows: Vec<(String, String, String, String, String, f64)> =
            sqlx::query_as(AssertSqlSafe(format!(
                "SELECT id, dense_text, sparse_text, metadata_json, source_file,
                    (dense_vector <=> $1::vector)::float8 AS distance
             FROM {table}
             ORDER BY distance
             LIMIT $2"
            )))
            .bind(&vec_sql)
            .bind(top_k as i64)
            .fetch_all(&pool)
            .await?;

        Ok(rows
            .into_iter()
            .map(
                |(id, dense_text, sparse_text, meta_json, source_file, distance)| {
                    let metadata: HashMap<String, Value> =
                        serde_json::from_str(&meta_json).unwrap_or_default();
                    SearchResult {
                        id,
                        dense_text,
                        sparse_text,
                        metadata,
                        similarity: (1.0 - distance) as f32,
                        source_file: Some(source_file).filter(|s| !s.is_empty()),
                        sparse_text_generator_id: None,
                        metadata_generator_id: None,
                    }
                },
            )
            .collect())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const DIMS: usize = 4;

    fn make_docs(count: usize) -> Vec<VectorDocument> {
        (0..count)
            .map(|i| VectorDocument {
                id: format!("{i:016x}"),
                dense_text: format!("dense text {i}"),
                sparse_text: format!("sparse text {i}"),
                dense_text_hash: format!("{i:016x}"),
                sparse_text_generator_id: "gen_v1".into(),
                metadata_generator_id: "meta_v1".into(),
                metadata: HashMap::new(),
                tags: vec![],
                dense_vector: vec![i as f32 / count as f32; DIMS],
                source_file: format!("src/file_{:03}.rs", i % 3),
                commit_hash: "abc123".into(),
            })
            .collect()
    }

    #[tokio::test]
    #[ignore = "requires PostgreSQL with pgvector extension"]
    async fn postgres_init_and_upsert() {
        let url = std::env::var("TEST_PG_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@localhost/virage_test".into());
        let store = PostgresStore::new(&url, "documents_test", DIMS);
        store.initialize().await.unwrap();

        let docs = make_docs(10);
        store.upsert(&docs).await.unwrap();

        let query = vec![0.5f32; DIMS];
        let results = store
            .search(&query, 3, SearchOptions::default())
            .await
            .unwrap();
        assert!(!results.is_empty());

        let hashes: Vec<&str> = vec!["0000000000000000", "0000000000000001", "9999999999999999"];
        let found = store.existing_hashes(&hashes).await.unwrap();
        assert!(found.contains("0000000000000000"));
        assert!(!found.contains("9999999999999999"));

        store.delete_by_source(&["src/file_000.rs"]).await.unwrap();
    }
}
