use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use qdrant_client::qdrant::{
    CreateCollectionBuilder, DeletePointsBuilder, Distance, Filter, GetPointsBuilder, PointStruct,
    ScrollPointsBuilder, SearchPointsBuilder, UpsertPointsBuilder, VectorParamsBuilder,
};
use qdrant_client::{Payload, Qdrant};
use serde_json::Value;

use super::{SearchOptions, SearchResult, VectorDocument, VectorStore};

// ─── QdrantStore ──────────────────────────────────────────────────────────────

pub struct QdrantStore {
    url: String,
    api_key: Option<String>,
    collection: String,
    dimensions: usize,
    client: tokio::sync::RwLock<Option<Qdrant>>,
}

impl QdrantStore {
    pub fn new(url: impl Into<String>, collection: impl Into<String>, dimensions: usize) -> Self {
        Self {
            url: url.into(),
            api_key: None,
            collection: collection.into(),
            dimensions,
            client: tokio::sync::RwLock::new(None),
        }
    }

    pub fn with_api_key(mut self, key: impl Into<String>) -> Self {
        self.api_key = Some(key.into());
        self
    }

    async fn get_client(&self) -> anyhow::Result<Qdrant> {
        self.client
            .read()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("QdrantStore: call initialize() first"))
    }

    /// Convert our string ID (16-char hex) to a qdrant u64 point ID.
    fn id_to_u64(id: &str) -> u64 {
        u64::from_str_radix(id, 16).unwrap_or_else(|_| {
            use std::collections::hash_map::DefaultHasher;
            use std::hash::{Hash, Hasher};
            let mut h = DefaultHasher::new();
            id.hash(&mut h);
            h.finish()
        })
    }

    fn doc_to_point(doc: &VectorDocument) -> anyhow::Result<PointStruct> {
        let point_id = Self::id_to_u64(&doc.id);
        let mut meta = serde_json::Map::new();
        for (k, v) in &doc.metadata {
            meta.insert(k.clone(), v.clone());
        }
        meta.insert("_id".to_string(), Value::String(doc.id.clone()));
        meta.insert(
            "dense_text".to_string(),
            Value::String(doc.dense_text.clone()),
        );
        meta.insert(
            "sparse_text".to_string(),
            Value::String(doc.sparse_text.clone()),
        );
        meta.insert(
            "dense_text_hash".to_string(),
            Value::String(doc.dense_text_hash.clone()),
        );
        meta.insert(
            "sparse_text_generator_id".to_string(),
            Value::String(doc.sparse_text_generator_id.clone()),
        );
        meta.insert(
            "metadata_generator_id".to_string(),
            Value::String(doc.metadata_generator_id.clone()),
        );
        meta.insert(
            "source_file".to_string(),
            Value::String(doc.source_file.clone()),
        );
        meta.insert(
            "commit_hash".to_string(),
            Value::String(doc.commit_hash.clone()),
        );
        let payload: Payload = serde_json::Value::Object(meta).try_into()?;
        Ok(PointStruct::new(
            point_id,
            doc.dense_vector.clone(),
            payload,
        ))
    }

    fn extract_str(payload: &HashMap<String, qdrant_client::qdrant::Value>, key: &str) -> String {
        use qdrant_client::qdrant::value::Kind;
        payload
            .get(key)
            .and_then(|v| match &v.kind {
                Some(Kind::StringValue(s)) => Some(s.clone()),
                _ => None,
            })
            .unwrap_or_default()
    }
}

#[async_trait]
impl VectorStore for QdrantStore {
    async fn initialize(&self) -> anyhow::Result<()> {
        let mut builder = Qdrant::from_url(&self.url);
        if let Some(key) = &self.api_key {
            builder = builder.api_key(key.clone());
        }
        let client = builder.build()?;

        let exists = client.collection_exists(&self.collection).await?;
        if !exists {
            client
                .create_collection(
                    CreateCollectionBuilder::new(&self.collection).vectors_config(
                        VectorParamsBuilder::new(self.dimensions as u64, Distance::Cosine),
                    ),
                )
                .await?;
        }

        *self.client.write().await = Some(client);
        Ok(())
    }

    async fn upsert(&self, docs: &[VectorDocument]) -> anyhow::Result<()> {
        if docs.is_empty() {
            return Ok(());
        }
        let client = self.get_client().await?;
        let points: Vec<PointStruct> = docs
            .iter()
            .map(Self::doc_to_point)
            .collect::<anyhow::Result<_>>()?;
        const BATCH: usize = 100;
        for chunk in points.chunks(BATCH) {
            client
                .upsert_points(UpsertPointsBuilder::new(&self.collection, chunk.to_vec()))
                .await?;
        }
        Ok(())
    }

    async fn delete_by_source(&self, files: &[&str]) -> anyhow::Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let client = self.get_client().await?;
        for file in files {
            let filter = Filter::must(vec![qdrant_client::qdrant::Condition::matches(
                "source_file",
                file.to_string(),
            )]);
            client
                .delete_points(DeletePointsBuilder::new(&self.collection).points(filter))
                .await?;
        }
        Ok(())
    }

    async fn existing_hashes(&self, hashes: &[&str]) -> anyhow::Result<HashSet<String>> {
        if hashes.is_empty() {
            return Ok(HashSet::new());
        }
        let client = self.get_client().await?;
        let ids: Vec<u64> = hashes.iter().map(|h| Self::id_to_u64(h)).collect();
        let point_ids: Vec<qdrant_client::qdrant::PointId> =
            ids.iter().copied().map(Into::into).collect();
        let resp = client
            .get_points(GetPointsBuilder::new(&self.collection, point_ids).with_payload(true))
            .await?;

        let mut found = HashSet::new();
        for pt in &resp.result {
            let id_str = Self::extract_str(&pt.payload, "_id");
            if !id_str.is_empty() {
                found.insert(id_str);
            }
        }
        Ok(found)
    }

    async fn current_state(&self) -> anyhow::Result<HashMap<String, String>> {
        let client = self.get_client().await?;
        let mut map = HashMap::new();
        let mut offset: Option<qdrant_client::qdrant::PointId> = None;
        const PAGE: u32 = 250;
        loop {
            let mut builder = ScrollPointsBuilder::new(&self.collection)
                .limit(PAGE)
                .with_payload(true);
            if let Some(ref off) = offset {
                builder = builder.offset(off.clone());
            }
            let resp = client.scroll(builder).await?;
            let pts = &resp.result;
            if pts.is_empty() {
                break;
            }
            for pt in pts {
                let sf = Self::extract_str(&pt.payload, "source_file");
                let ch = Self::extract_str(&pt.payload, "commit_hash");
                if !sf.is_empty() && !ch.is_empty() {
                    map.insert(sf, ch);
                }
            }
            match resp.next_page_offset {
                Some(next) => offset = Some(next),
                None => break,
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
        let client = self.get_client().await?;
        let resp = client
            .search_points(
                SearchPointsBuilder::new(&self.collection, query.to_vec(), top_k as u64)
                    .with_payload(true),
            )
            .await?;

        let results = resp
            .result
            .iter()
            .map(|pt| {
                let dense_text = Self::extract_str(&pt.payload, "dense_text");
                let sparse_text = Self::extract_str(&pt.payload, "sparse_text");
                let id = Self::extract_str(&pt.payload, "_id");
                let source_file = Self::extract_str(&pt.payload, "source_file");
                let sparse_gen_id = Self::extract_str(&pt.payload, "sparse_text_generator_id");
                let meta_gen_id = Self::extract_str(&pt.payload, "metadata_generator_id");
                // Re-assemble metadata (all non-system keys)
                let system_keys = [
                    "_id",
                    "dense_text",
                    "sparse_text",
                    "dense_text_hash",
                    "sparse_text_generator_id",
                    "metadata_generator_id",
                    "source_file",
                    "commit_hash",
                ];
                let metadata: HashMap<String, serde_json::Value> = pt
                    .payload
                    .iter()
                    .filter(|(k, _)| !system_keys.contains(&k.as_str()))
                    .map(|(k, v)| {
                        use qdrant_client::qdrant::value::Kind;
                        let jv = match &v.kind {
                            Some(Kind::StringValue(s)) => serde_json::Value::String(s.clone()),
                            Some(Kind::IntegerValue(n)) => serde_json::json!(n),
                            Some(Kind::DoubleValue(f)) => serde_json::json!(f),
                            Some(Kind::BoolValue(b)) => serde_json::Value::Bool(*b),
                            _ => serde_json::Value::Null,
                        };
                        (k.clone(), jv)
                    })
                    .collect();
                SearchResult {
                    id,
                    dense_text,
                    sparse_text,
                    metadata,
                    similarity: pt.score,
                    source_file: Some(source_file).filter(|s| !s.is_empty()),
                    sparse_text_generator_id: Some(sparse_gen_id).filter(|s| !s.is_empty()),
                    metadata_generator_id: Some(meta_gen_id).filter(|s| !s.is_empty()),
                }
            })
            .collect();
        Ok(results)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const DIMS: usize = 4;
    const QDRANT_URL: &str = "http://localhost:6333";

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
    #[ignore = "requires Qdrant running at http://localhost:6333"]
    async fn qdrant_init_and_upsert() {
        let col = format!(
            "test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        );
        let store = QdrantStore::new(QDRANT_URL, &col, DIMS);
        store.initialize().await.unwrap();

        let docs = make_docs(10);
        store.upsert(&docs).await.unwrap();

        let query = vec![0.5f32; DIMS];
        let results = store
            .search(&query, 3, SearchOptions::default())
            .await
            .unwrap();
        assert!(!results.is_empty());

        store.delete_by_source(&["src/file_000.rs"]).await.unwrap();
    }
}
