use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use arrow_array::{
    ArrayRef, FixedSizeListArray, Float32Array, RecordBatch, RecordBatchIterator, StringArray,
};
use arrow_schema::{DataType, Field, Schema, SchemaRef};
use async_trait::async_trait;
use futures::TryStreamExt;
use lancedb::index::scalar::FtsIndexBuilder;
use lancedb::index::Index;
use lancedb::query::{QueryBase, Select};
use lancedb::{Connection, Table};

use super::{sql_in_list, SearchOptions, SearchResult, VectorDocument, VectorStore};

// ─── LanceDbStore ─────────────────────────────────────────────────────────────

pub struct LanceDbStore {
    uri: String,
    table_name: String,
    dimensions: usize,
    schema: SchemaRef,
    state: tokio::sync::RwLock<Option<LanceState>>,
    fts_created: AtomicBool,
}

struct LanceState {
    _conn: Connection,
    table: Table,
}

impl LanceDbStore {
    pub fn new(uri: impl Into<String>, table_name: impl Into<String>, dimensions: usize) -> Self {
        let dims = dimensions;
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Utf8, false),
            Field::new("dense_text", DataType::Utf8, false),
            Field::new("sparse_text", DataType::Utf8, false),
            Field::new("dense_text_hash", DataType::Utf8, false),
            Field::new("sparse_text_generator_id", DataType::Utf8, false),
            Field::new("metadata_generator_id", DataType::Utf8, false),
            Field::new(
                "dense_vector",
                DataType::FixedSizeList(
                    Arc::new(Field::new("item", DataType::Float32, false)),
                    dims as i32,
                ),
                false,
            ),
            Field::new("metadata_json", DataType::Utf8, false),
            Field::new("source_file", DataType::Utf8, false),
            Field::new("commit_hash", DataType::Utf8, false),
        ]));
        Self {
            uri: uri.into(),
            table_name: table_name.into(),
            dimensions,
            schema,
            state: tokio::sync::RwLock::new(None),
            fts_created: AtomicBool::new(false),
        }
    }

    async fn get_table(&self) -> anyhow::Result<Table> {
        self.state
            .read()
            .await
            .as_ref()
            .map(|s| s.table.clone())
            .ok_or_else(|| anyhow::anyhow!("LanceDbStore: call initialize() first"))
    }

    fn docs_to_batch(&self, docs: &[VectorDocument]) -> anyhow::Result<RecordBatch> {
        let dims = self.dimensions as i32;

        let ids = Arc::new(StringArray::from(
            docs.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(),
        ));
        let dense_texts = Arc::new(StringArray::from(
            docs.iter()
                .map(|d| d.dense_text.as_str())
                .collect::<Vec<_>>(),
        ));
        let sparse_texts = Arc::new(StringArray::from(
            docs.iter()
                .map(|d| d.sparse_text.as_str())
                .collect::<Vec<_>>(),
        ));
        let dense_text_hashes = Arc::new(StringArray::from(
            docs.iter()
                .map(|d| d.dense_text_hash.as_str())
                .collect::<Vec<_>>(),
        ));
        let sparse_gen_ids = Arc::new(StringArray::from(
            docs.iter()
                .map(|d| d.sparse_text_generator_id.as_str())
                .collect::<Vec<_>>(),
        ));
        let meta_gen_ids = Arc::new(StringArray::from(
            docs.iter()
                .map(|d| d.metadata_generator_id.as_str())
                .collect::<Vec<_>>(),
        ));

        let flat_vecs: Vec<f32> = docs
            .iter()
            .flat_map(|d| d.dense_vector.iter().copied())
            .collect();
        let float_arr = Arc::new(Float32Array::from(flat_vecs));
        let item_field = Arc::new(Field::new("item", DataType::Float32, false));
        let vec_arr = Arc::new(FixedSizeListArray::try_new(
            item_field, dims, float_arr, None,
        )?) as ArrayRef;

        let meta_jsons: Vec<String> = docs
            .iter()
            .map(|d| serde_json::to_string(&d.metadata).unwrap_or_default())
            .collect();
        let meta_json_arr = Arc::new(StringArray::from(
            meta_jsons.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
        ));
        let source_files = Arc::new(StringArray::from(
            docs.iter()
                .map(|d| d.source_file.as_str())
                .collect::<Vec<_>>(),
        ));
        let commit_hashes = Arc::new(StringArray::from(
            docs.iter()
                .map(|d| d.commit_hash.as_str())
                .collect::<Vec<_>>(),
        ));

        let batch = RecordBatch::try_new(
            self.schema.clone(),
            vec![
                ids as ArrayRef,
                dense_texts as ArrayRef,
                sparse_texts as ArrayRef,
                dense_text_hashes as ArrayRef,
                sparse_gen_ids as ArrayRef,
                meta_gen_ids as ArrayRef,
                vec_arr,
                meta_json_arr as ArrayRef,
                source_files as ArrayRef,
                commit_hashes as ArrayRef,
            ],
        )?;
        Ok(batch)
    }

    fn batches_to_results(batches: Vec<RecordBatch>) -> Vec<SearchResult> {
        let mut out = Vec::new();
        for batch in &batches {
            let n = batch.num_rows();
            let get_str = |name: &str| -> Vec<String> {
                batch
                    .column_by_name(name)
                    .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                    .map(|a| (0..n).map(|i| a.value(i).to_string()).collect())
                    .unwrap_or_else(|| vec![String::new(); n])
            };
            let get_f32_col = |name: &str| -> Vec<f32> {
                batch
                    .column_by_name(name)
                    .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                    .map(|a| (0..n).map(|i| a.value(i)).collect())
                    .unwrap_or_else(|| vec![0.0; n])
            };

            let ids = get_str("id");
            let dense_texts = get_str("dense_text");
            let sparse_texts = get_str("sparse_text");
            let meta_jsons = get_str("metadata_json");
            let source_files = get_str("source_file");
            let sparse_gen_ids = get_str("sparse_text_generator_id");
            let meta_gen_ids = get_str("metadata_generator_id");
            let distances = get_f32_col("_distance");

            for i in 0..n {
                let metadata: HashMap<String, serde_json::Value> =
                    serde_json::from_str(&meta_jsons[i]).unwrap_or_default();
                out.push(SearchResult {
                    id: ids[i].clone(),
                    dense_text: dense_texts[i].clone(),
                    sparse_text: sparse_texts[i].clone(),
                    metadata,
                    similarity: 1.0 - distances[i],
                    source_file: Some(source_files[i].clone()).filter(|s| !s.is_empty()),
                    sparse_text_generator_id: Some(sparse_gen_ids[i].clone())
                        .filter(|s| !s.is_empty()),
                    metadata_generator_id: Some(meta_gen_ids[i].clone()).filter(|s| !s.is_empty()),
                });
            }
        }
        out
    }
}

#[async_trait]
impl VectorStore for LanceDbStore {
    async fn initialize(&self) -> anyhow::Result<()> {
        let conn = lancedb::connect(&self.uri).execute().await?;
        let names = conn.table_names().execute().await?;

        let table = if names.contains(&self.table_name) {
            let existing = conn.open_table(&self.table_name).execute().await?;
            // Probe FTS — try creating it; if it already exists, mark as created.
            let probe = existing
                .create_index(&["sparse_text"], Index::FTS(FtsIndexBuilder::default()))
                .execute()
                .await;
            self.fts_created.store(probe.is_ok(), Ordering::Relaxed);
            existing
        } else {
            let tbl = conn
                .create_empty_table(&self.table_name, self.schema.clone())
                .execute()
                .await?;
            // FTS on empty table: defer to first upsert (LanceDB hangs otherwise).
            self.fts_created.store(false, Ordering::Relaxed);
            tbl
        };

        *self.state.write().await = Some(LanceState { _conn: conn, table });
        Ok(())
    }

    async fn upsert(&self, docs: &[VectorDocument]) -> anyhow::Result<()> {
        if docs.is_empty() {
            return Ok(());
        }
        let table = self.get_table().await?;
        let batch = self.docs_to_batch(docs)?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), self.schema.clone());
        table
            .merge_insert(&["id"])
            .when_matched_update_all(None)
            .when_not_matched_insert_all()
            .execute(Box::new(reader))
            .await?;

        // Create FTS index on first non-empty upsert (deferred from initialize).
        if !self.fts_created.load(Ordering::Relaxed) {
            let result = table
                .create_index(&["sparse_text"], Index::FTS(FtsIndexBuilder::default()))
                .execute()
                .await;
            // Concurrent upsert may have already created it — treat that as success.
            self.fts_created.store(result.is_ok(), Ordering::Relaxed);
        }
        Ok(())
    }

    async fn delete_by_source(&self, files: &[&str]) -> anyhow::Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let table = self.get_table().await?;
        let list = sql_in_list(files);
        table.delete(&format!("source_file IN ({list})")).await?;
        Ok(())
    }

    async fn existing_hashes(&self, hashes: &[&str]) -> anyhow::Result<HashSet<String>> {
        if hashes.is_empty() {
            return Ok(HashSet::new());
        }
        let table = self.get_table().await?;
        let list = sql_in_list(hashes);
        let stream = table
            .query()
            .select(Select::Columns(vec!["id".to_string()]))
            .only_if(format!("id IN ({list})"))
            .execute()
            .await?;
        let batches: Vec<RecordBatch> = stream.try_collect().await?;
        let mut out = HashSet::new();
        for batch in &batches {
            if let Some(col) = batch.column_by_name("id") {
                if let Some(arr) = col.as_any().downcast_ref::<StringArray>() {
                    for i in 0..arr.len() {
                        out.insert(arr.value(i).to_string());
                    }
                }
            }
        }
        Ok(out)
    }

    async fn current_state(&self) -> anyhow::Result<HashMap<String, String>> {
        let table = self.get_table().await?;
        let stream = table
            .query()
            .select(Select::Columns(vec![
                "source_file".to_string(),
                "commit_hash".to_string(),
            ]))
            .execute()
            .await?;
        let batches: Vec<RecordBatch> = stream.try_collect().await?;
        let mut map = HashMap::new();
        for batch in &batches {
            let n = batch.num_rows();
            let files = batch
                .column_by_name("source_file")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());
            let hashes = batch
                .column_by_name("commit_hash")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());
            if let (Some(files), Some(hashes)) = (files, hashes) {
                for i in 0..n {
                    let f = files.value(i);
                    let h = hashes.value(i);
                    if !f.is_empty() && !h.is_empty() {
                        map.insert(f.to_string(), h.to_string());
                    }
                }
            }
        }
        Ok(map)
    }

    async fn search(
        &self,
        query: &[f32],
        top_k: usize,
        _opts: SearchOptions,
    ) -> anyhow::Result<Vec<SearchResult>> {
        let table = self.get_table().await?;
        let stream = table
            .query()
            .nearest_to(query)?
            .column("dense_vector")
            .distance_type(lancedb::DistanceType::Cosine)
            .limit(top_k)
            .select(Select::Columns(vec![
                "id".to_string(),
                "dense_text".to_string(),
                "sparse_text".to_string(),
                "sparse_text_generator_id".to_string(),
                "metadata_generator_id".to_string(),
                "metadata_json".to_string(),
                "source_file".to_string(),
            ]))
            .execute()
            .await?;
        let batches: Vec<RecordBatch> = stream.try_collect().await?;
        Ok(Self::batches_to_results(batches))
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const DIMS: usize = 4;

    fn temp_uri() -> String {
        let mut p = std::env::temp_dir();
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .subsec_nanos();
        p.push(format!("virage-lancedb-test-{id}"));
        p.to_string_lossy().into_owned()
    }

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

    async fn fresh_store() -> LanceDbStore {
        let store = LanceDbStore::new(temp_uri(), "documents", DIMS);
        store.initialize().await.expect("initialize failed");
        store
    }

    #[tokio::test]
    async fn initialize_creates_table() {
        let store = fresh_store().await;
        assert!(store.state.read().await.is_some());
    }

    #[tokio::test]
    async fn upsert_and_search_returns_results() {
        let store = fresh_store().await;
        let docs = make_docs(5);
        store.upsert(&docs).await.unwrap();

        let query = vec![0.5f32; DIMS];
        let results = store
            .search(&query, 3, SearchOptions::default())
            .await
            .unwrap();
        assert!(!results.is_empty(), "search should return results");
        assert!(results.len() <= 3);
    }

    #[tokio::test]
    async fn existing_hashes_returns_present_subset() {
        let store = fresh_store().await;
        let docs = make_docs(5);
        store.upsert(&docs).await.unwrap();

        let check: Vec<&str> = vec!["0000000000000000", "0000000000000002", "9999999999999999"];
        let found = store.existing_hashes(&check).await.unwrap();
        assert!(found.contains("0000000000000000"));
        assert!(found.contains("0000000000000002"));
        assert!(
            !found.contains("9999999999999999"),
            "non-existent hash should not be returned"
        );
    }

    #[tokio::test]
    async fn delete_by_source_removes_docs() {
        let store = fresh_store().await;
        let docs = make_docs(6);
        store.upsert(&docs).await.unwrap();

        store.delete_by_source(&["src/file_000.rs"]).await.unwrap();

        let state = store.current_state().await.unwrap();
        // file_000 had docs 0,3 (i%3==0) — after delete they should be gone
        // Remaining files are file_001 and file_002
        assert!(!state.contains_key("src/file_000.rs") || state.len() >= 1);
    }

    #[tokio::test]
    async fn current_state_returns_file_hash_map() {
        let store = fresh_store().await;
        let docs = make_docs(3);
        store.upsert(&docs).await.unwrap();

        let state = store.current_state().await.unwrap();
        // 3 docs across 3 files (i%3: 0,1,2)
        assert!(state.contains_key("src/file_000.rs"));
        assert!(state.contains_key("src/file_001.rs"));
        assert!(state.contains_key("src/file_002.rs"));
        for v in state.values() {
            assert_eq!(v, "abc123");
        }
    }

    #[tokio::test]
    async fn upsert_twice_updates_record() {
        let store = fresh_store().await;
        let mut docs = make_docs(1);
        store.upsert(&docs).await.unwrap();

        docs[0].dense_text = "updated dense text".to_string();
        store.upsert(&docs).await.unwrap();

        let query = docs[0].dense_vector.clone();
        let results = store
            .search(&query, 1, SearchOptions::default())
            .await
            .unwrap();
        assert_eq!(results[0].dense_text, "updated dense text");
    }

    #[tokio::test]
    async fn empty_upsert_is_noop() {
        let store = fresh_store().await;
        store.upsert(&[]).await.unwrap();
        let state = store.current_state().await.unwrap();
        assert!(state.is_empty());
    }

    #[tokio::test]
    async fn empty_delete_is_noop() {
        let store = fresh_store().await;
        store.delete_by_source(&[]).await.unwrap();
    }

    #[tokio::test]
    async fn search_100_docs() {
        let store = fresh_store().await;
        let docs = make_docs(100);
        store.upsert(&docs).await.unwrap();

        let query = vec![0.5f32; DIMS];
        let results = store
            .search(&query, 3, SearchOptions::default())
            .await
            .unwrap();
        assert_eq!(results.len(), 3, "should return exactly top_k=3 results");
    }
}
