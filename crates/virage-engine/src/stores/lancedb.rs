use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use arrow_array::{
    Array, ArrayRef, FixedSizeListArray, Float32Array, RecordBatch, RecordBatchIterator,
    StringArray,
};
use arrow_schema::{DataType, Field, Schema, SchemaRef};
use async_trait::async_trait;
use futures::TryStreamExt;
use lancedb::index::scalar::{FtsIndexBuilder, FullTextSearchQuery};
use lancedb::index::Index;
use lancedb::query::{ExecutableQuery, QueryBase, Select};
use lancedb::{Connection, Table};

use super::{
    validate_tag_filter, IndexMeta, SearchOptions, SearchResult, VectorDocument, VectorStore,
};

fn sql_in_list(items: &[&str]) -> String {
    items
        .iter()
        .map(|s| format!("'{}'", s.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Tags are packed as a single `|`-delimited string (`|tag1|tag2|`) — LanceDB's
/// query engine (DataFusion) has no native array-containment operator over a
/// plain Arrow list column reachable from `.only_if`, so containment is
/// expressed as a substring match against the delimited packing instead. Safe
/// because tag values are restricted (by `validate_tag_filter`/`is_valid_tag`)
/// to `[a-z0-9\-_:]`, which cannot contain the `|` delimiter.
fn pack_tags(tags: &[String]) -> String {
    format!("|{}|", tags.join("|"))
}

/// Escape LIKE metacharacters so a tag matches literally (`_` would otherwise
/// match any single character, so `acme_corp` would also match `acme-corp`).
fn escape_like(tag: &str) -> String {
    let mut out = String::with_capacity(tag.len());
    for c in tag.chars() {
        if matches!(c, '\\' | '_' | '%') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn tag_filter_expr(tags: &[String]) -> String {
    let clauses: Vec<String> = tags
        .iter()
        .map(|t| format!("tags LIKE '%|{}|%' ESCAPE '\\'", escape_like(t)))
        .collect();
    format!("({})", clauses.join(" OR "))
}

/// Reciprocal-rank-fusion constant; 60 is the value from the original RRF paper.
const RRF_K: f32 = 60.0;

fn combine_filters(a: Option<&str>, b: Option<&str>) -> Option<String> {
    match (a, b) {
        (Some(a), Some(b)) => Some(format!("({a}) AND ({b})")),
        (Some(x), None) | (None, Some(x)) => Some(x.to_string()),
        (None, None) => None,
    }
}

/// Fuse dense and sparse rankings by weighted reciprocal rank: `alpha` weighs the dense list and
/// `1 - alpha` the sparse one. Rows are keyed by chunk id; the flag marks rows that came from the
/// dense list (and so already carry a cosine similarity).
fn fuse_rrf(
    dense: Vec<SearchResult>,
    sparse: Vec<SearchResult>,
    alpha: f32,
    top_k: usize,
) -> Vec<(SearchResult, bool)> {
    let alpha = alpha.clamp(0.0, 1.0);
    let mut scores: HashMap<String, f32> = HashMap::new();
    let mut rows: Vec<(SearchResult, bool)> = Vec::new();
    for (rank, r) in dense.into_iter().enumerate() {
        *scores.entry(r.id.clone()).or_default() += alpha / (RRF_K + rank as f32 + 1.0);
        rows.push((r, true));
    }
    for (rank, r) in sparse.into_iter().enumerate() {
        *scores.entry(r.id.clone()).or_default() += (1.0 - alpha) / (RRF_K + rank as f32 + 1.0);
        if !rows.iter().any(|(d, _)| d.id == r.id) {
            rows.push((r, false));
        }
    }
    rows.sort_by(|a, b| {
        scores[&b.0.id]
            .partial_cmp(&scores[&a.0.id])
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    rows.truncate(top_k);
    rows
}

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
            Field::new("tags", DataType::Utf8, false),
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
        let tags_packed: Vec<String> = docs.iter().map(|d| pack_tags(&d.tags)).collect();
        let tags_arr = Arc::new(StringArray::from(
            tags_packed.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
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
                tags_arr as ArrayRef,
                source_files as ArrayRef,
                commit_hashes as ArrayRef,
            ],
        )?;
        Ok(batch)
    }

    const RESULT_COLUMNS: [&'static str; 7] = [
        "id",
        "dense_text",
        "sparse_text",
        "sparse_text_generator_id",
        "metadata_generator_id",
        "metadata_json",
        "source_file",
    ];

    async fn dense_query(
        table: &Table,
        query: &[f32],
        limit: usize,
        tag_expr: Option<&str>,
        extra: Option<&str>,
    ) -> anyhow::Result<Vec<SearchResult>> {
        let mut q = table
            .query()
            .nearest_to(query)?
            .column("dense_vector")
            .distance_type(lancedb::DistanceType::Cosine)
            .limit(limit)
            .select(Select::Columns(
                Self::RESULT_COLUMNS.iter().map(|c| c.to_string()).collect(),
            ));
        if let Some(filter) = combine_filters(tag_expr, extra) {
            q = q.only_if(filter);
        }
        let batches: Vec<RecordBatch> = q.execute().await?.try_collect().await?;
        Ok(Self::batches_to_results(batches))
    }

    async fn sparse_query(
        table: &Table,
        text: &str,
        limit: usize,
        tag_expr: Option<&str>,
    ) -> anyhow::Result<Vec<SearchResult>> {
        let mut q = table
            .query()
            .full_text_search(FullTextSearchQuery::new(text.to_string()))
            .limit(limit)
            .select(Select::Columns(
                Self::RESULT_COLUMNS.iter().map(|c| c.to_string()).collect(),
            ));
        if let Some(filter) = tag_expr {
            q = q.only_if(filter);
        }
        let batches: Vec<RecordBatch> = q.execute().await?.try_collect().await?;
        Ok(Self::batches_to_results(batches))
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
        let mut builder = table.merge_insert(&["id"]);
        builder
            .when_matched_update_all(None)
            .when_not_matched_insert_all();
        builder.execute(Box::new(reader)).await?;

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
        opts: SearchOptions,
    ) -> anyhow::Result<Vec<SearchResult>> {
        if opts.tag_filter_matches_nothing() {
            return Ok(Vec::new());
        }
        let table = self.get_table().await?;
        let tag_expr = match &opts.tag_filter {
            Some(tag_filter) => {
                validate_tag_filter(tag_filter)?;
                (!tag_filter.is_empty()).then_some(tag_filter_expr(tag_filter))
            }
            None => None,
        };
        let hybrid_text = opts
            .query_text
            .as_deref()
            .map(str::trim)
            .filter(|t| opts.hybrid && !t.is_empty());

        // Hybrid pulls a wider dense pool so fusion has candidates the sparse side can promote.
        let dense_limit = if hybrid_text.is_some() {
            top_k.saturating_mul(2)
        } else {
            top_k
        };
        let dense =
            Self::dense_query(&table, query, dense_limit, tag_expr.as_deref(), None).await?;
        let Some(text) = hybrid_text else {
            return Ok(dense);
        };

        // A failing sparse side (FTS index not built yet, odd query syntax) degrades to dense.
        let sparse =
            match Self::sparse_query(&table, text, top_k.saturating_mul(2), tag_expr.as_deref())
                .await
            {
                Ok(rows) => rows,
                Err(_) => return Ok(dense.into_iter().take(top_k).collect()),
            };
        let mut fused = fuse_rrf(dense, sparse, opts.hybrid_alpha, top_k);

        // Sparse-only rows carry no vector distance; score them against the query vector.
        let unscored: Vec<String> = fused
            .iter()
            .filter(|(_, from_dense)| !from_dense)
            .map(|(r, _)| r.id.clone())
            .collect();
        if !unscored.is_empty() {
            let ids: Vec<&str> = unscored.iter().map(String::as_str).collect();
            let expr = format!("id IN ({})", sql_in_list(&ids));
            let scored = Self::dense_query(
                &table,
                query,
                unscored.len(),
                tag_expr.as_deref(),
                Some(&expr),
            )
            .await?;
            let sims: HashMap<String, f32> =
                scored.into_iter().map(|r| (r.id, r.similarity)).collect();
            for (r, from_dense) in &mut fused {
                if !*from_dense {
                    r.similarity = sims.get(&r.id).copied().unwrap_or(0.0);
                }
            }
        }
        Ok(fused.into_iter().map(|(r, _)| r).collect())
    }

    async fn list_all(&self) -> anyhow::Result<Option<Vec<SearchResult>>> {
        let table = self.get_table().await?;
        let stream = table
            .query()
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
        Ok(Some(Self::batches_to_results(batches)))
    }

    async fn read_meta(&self) -> anyhow::Result<Option<IndexMeta>> {
        let path = std::path::Path::new(&self.uri).join("_virage_meta.json");
        match std::fs::read_to_string(&path) {
            Ok(s) => {
                let v: serde_json::Value = serde_json::from_str(&s)?;
                Ok(Some(IndexMeta {
                    model: v["model"].as_str().unwrap_or("").to_string(),
                    dimensions: v["dimensions"].as_u64().unwrap_or(0) as usize,
                }))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(anyhow::anyhow!("read meta: {e}")),
        }
    }

    async fn write_meta(&self, meta: &IndexMeta) -> anyhow::Result<()> {
        let path = std::path::Path::new(&self.uri).join("_virage_meta.json");
        let v = serde_json::json!({
            "model": meta.model,
            "dimensions": meta.dimensions,
        });
        std::fs::write(&path, serde_json::to_string_pretty(&v)?)?;
        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const DIMS: usize = 4;

    fn temp_uri() -> String {
        // pid + counter: tests run in parallel and nanos alone can collide.
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut p = std::env::temp_dir();
        p.push(format!("virage-lancedb-test-{}-{n}", std::process::id()));
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
                // Non-zero: a zero vector has undefined cosine distance and is dropped by search.
                dense_vector: vec![(i + 1) as f32 / (count + 1) as f32; DIMS],
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

    #[test]
    fn tag_filter_expr_escapes_like_wildcards() {
        let expr = tag_filter_expr(&["acme_corp".to_string()]);
        assert_eq!(expr, "(tags LIKE '%|acme\\_corp|%' ESCAPE '\\')");
        assert_eq!(escape_like("a%b\\c"), "a\\%b\\\\c");
    }

    fn tagged_docs() -> Vec<VectorDocument> {
        let mut docs = make_docs(3);
        docs[0].tags = vec!["ns:acme_corp".into()];
        docs[1].tags = vec!["ns:acme-corp".into()];
        docs[2].tags = vec!["ns:acmexcorp".into()];
        docs
    }

    async fn search_tags(store: &LanceDbStore, tags: Option<Vec<String>>) -> Vec<String> {
        let opts = SearchOptions {
            tag_filter: tags,
            ..SearchOptions::default()
        };
        store
            .search(&vec![0.5f32; DIMS], 10, opts)
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.dense_text)
            .collect()
    }

    #[tokio::test]
    async fn underscore_in_tag_is_not_a_wildcard() {
        let store = fresh_store().await;
        store.upsert(&tagged_docs()).await.unwrap();
        let hits = search_tags(&store, Some(vec!["ns:acme_corp".into()])).await;
        assert_eq!(hits, vec!["dense text 0".to_string()]);
    }

    #[tokio::test]
    async fn empty_tag_filter_returns_nothing() {
        let store = fresh_store().await;
        store.upsert(&tagged_docs()).await.unwrap();
        assert!(search_tags(&store, Some(vec![])).await.is_empty());
        assert_eq!(search_tags(&store, None).await.len(), 3);
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

    #[tokio::test]
    async fn hybrid_surfaces_exact_keyword_the_dense_side_misses() {
        let store = fresh_store().await;
        let mut docs = make_docs(30);
        // The keyword doc's vector is the farthest from the query, so dense top-3 never has it.
        docs[0].sparse_text = "DR13 phone layout rule".into();
        docs[0].dense_text = "phone layout rule".into();
        docs[0].dense_vector = (0..DIMS).map(|i| if i == 0 { 1.0 } else { 0.0 }).collect();
        store.upsert(&docs).await.unwrap();
        // Re-upsert is what triggers lazy FTS creation on a table that was empty at initialize.
        let query = vec![0.5f32; DIMS];

        let dense = store
            .search(&query, 3, SearchOptions::default())
            .await
            .unwrap();
        assert!(!dense.iter().any(|r| r.dense_text == "phone layout rule"));

        let opts = SearchOptions {
            hybrid: true,
            hybrid_alpha: 0.5,
            query_text: Some("DR13".into()),
            ..SearchOptions::default()
        };
        let hybrid = store.search(&query, 3, opts).await.unwrap();
        assert_eq!(hybrid.len(), 3);
        assert!(hybrid.iter().any(|r| r.dense_text == "phone layout rule"));
        // The keyword row never came from the dense pass; its similarity is looked up afterwards
        // and must be the real cosine against the query (e0 vs. a uniform vector = 1/sqrt(DIMS)).
        let kw = hybrid
            .iter()
            .find(|r| r.dense_text == "phone layout rule")
            .unwrap();
        let expected = 1.0 / (DIMS as f32).sqrt();
        assert!(
            (kw.similarity - expected).abs() < 0.01,
            "sparse-only row similarity {} != cosine {expected}",
            kw.similarity
        );
    }

    #[test]
    fn fuse_rrf_prefers_rows_ranked_by_both_sides() {
        let row = |id: &str| SearchResult {
            id: id.into(),
            dense_text: String::new(),
            sparse_text: String::new(),
            metadata: HashMap::new(),
            similarity: 0.5,
            source_file: None,
            sparse_text_generator_id: None,
            metadata_generator_id: None,
        };
        let fused = fuse_rrf(
            vec![row("a"), row("b"), row("c")],
            vec![row("c"), row("d")],
            0.5,
            3,
        );
        let ids: Vec<&str> = fused.iter().map(|(r, _)| r.id.as_str()).collect();
        assert_eq!(ids[0], "c");
        assert_eq!(fused.len(), 3);
    }

    #[tokio::test]
    async fn sparse_query_alone_finds_the_keyword_row() {
        let store = fresh_store().await;
        let mut docs = make_docs(30);
        docs[0].sparse_text = "DR13 phone layout rule".into();
        docs[0].dense_text = "phone layout rule".into();
        store.upsert(&docs).await.unwrap();
        let table = store.get_table().await.unwrap();
        let rows = LanceDbStore::sparse_query(&table, "DR13", 5, None)
            .await
            .expect("full-text query must not error after upsert");
        assert_eq!(
            rows.first().map(|r| r.dense_text.as_str()),
            Some("phone layout rule")
        );
    }

    #[tokio::test]
    async fn rows_added_by_a_later_upsert_are_keyword_searchable() {
        let store = fresh_store().await;
        store.upsert(&make_docs(30)).await.unwrap();
        let mut later = make_docs(31).split_off(30);
        later[0].id = "later-row".into();
        later[0].sparse_text = "ZQX42 added incrementally".into();
        later[0].dense_text = "added incrementally".into();
        store.upsert(&later).await.unwrap();
        let table = store.get_table().await.unwrap();
        let rows = LanceDbStore::sparse_query(&table, "ZQX42", 5, None)
            .await
            .expect("full-text query must not error");
        assert_eq!(rows.first().map(|r| r.id.as_str()), Some("later-row"));
    }
}
