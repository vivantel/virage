use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{SearchOptions, SearchResult, VectorDocument, VectorStore};

// ─── ChromaDB REST types ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ChromaCollection {
    id: String,
    #[allow(dead_code)]
    name: String,
}

#[derive(Serialize)]
struct CreateCollectionBody<'a> {
    name: &'a str,
    metadata: serde_json::Value,
    get_or_create: bool,
}

#[derive(Serialize)]
struct UpsertBody {
    ids: Vec<String>,
    embeddings: Vec<Vec<f32>>,
    documents: Vec<String>,
    metadatas: Vec<HashMap<String, Value>>,
}

#[derive(Serialize)]
struct DeleteBody {
    r#where: Value,
}

#[derive(Serialize)]
struct QueryBody {
    query_embeddings: Vec<Vec<f32>>,
    n_results: usize,
    include: Vec<String>,
}

#[derive(Deserialize)]
struct QueryResponse {
    ids: Vec<Vec<String>>,
    distances: Option<Vec<Vec<f64>>>,
    documents: Option<Vec<Vec<String>>>,
    metadatas: Option<Vec<Vec<HashMap<String, Value>>>>,
}

#[derive(Serialize)]
struct GetBody {
    ids: Vec<String>,
    include: Vec<String>,
}

#[derive(Deserialize)]
struct GetResponse {
    ids: Vec<String>,
}

#[derive(Serialize)]
struct ScrollBody {
    limit: usize,
    offset: Option<usize>,
    include: Vec<String>,
}

#[derive(Deserialize)]
struct ScrollResponse {
    ids: Vec<String>,
    metadatas: Option<Vec<HashMap<String, Value>>>,
}

// ─── ChromaDbStore ────────────────────────────────────────────────────────────

pub struct ChromaDbStore {
    base_url: String,
    collection_name: String,
    api_key: Option<String>,
    http: Client,
    collection_id: tokio::sync::RwLock<Option<String>>,
}

impl ChromaDbStore {
    pub fn new(base_url: impl Into<String>, collection_name: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            collection_name: collection_name.into(),
            api_key: None,
            http: Client::new(),
            collection_id: tokio::sync::RwLock::new(None),
        }
    }

    pub fn with_api_key(mut self, key: impl Into<String>) -> Self {
        self.api_key = Some(key.into());
        self
    }

    fn request_builder(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let url = format!("{}/{}", self.base_url, path.trim_start_matches('/'));
        let mut req = self.http.request(method, &url);
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }
        req
    }

    async fn get_collection_id(&self) -> anyhow::Result<String> {
        self.collection_id
            .read()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("ChromaDbStore: call initialize() first"))
    }

    fn doc_to_meta(doc: &VectorDocument) -> HashMap<String, Value> {
        let mut meta = doc.metadata.clone();
        meta.insert("source_file".into(), Value::String(doc.source_file.clone()));
        meta.insert("commit_hash".into(), Value::String(doc.commit_hash.clone()));
        meta.insert(
            "dense_text_hash".into(),
            Value::String(doc.dense_text_hash.clone()),
        );
        meta.insert("sparse_text".into(), Value::String(doc.sparse_text.clone()));
        meta.insert(
            "sparse_text_generator_id".into(),
            Value::String(doc.sparse_text_generator_id.clone()),
        );
        meta.insert(
            "metadata_generator_id".into(),
            Value::String(doc.metadata_generator_id.clone()),
        );
        meta
    }
}

#[async_trait]
impl VectorStore for ChromaDbStore {
    async fn initialize(&self) -> anyhow::Result<()> {
        let body = CreateCollectionBody {
            name: &self.collection_name,
            metadata: serde_json::json!({ "hnsw:space": "cosine" }),
            get_or_create: true,
        };
        let resp = self
            .request_builder(reqwest::Method::POST, "api/v1/collections")
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "ChromaDB create_collection failed {status}: {body}"
            ));
        }
        let col: ChromaCollection = resp.json().await?;
        *self.collection_id.write().await = Some(col.id);
        Ok(())
    }

    async fn upsert(&self, docs: &[VectorDocument]) -> anyhow::Result<()> {
        if docs.is_empty() {
            return Ok(());
        }
        let col_id = self.get_collection_id().await?;
        const BATCH: usize = 100;
        for chunk in docs.chunks(BATCH) {
            let body = UpsertBody {
                ids: chunk.iter().map(|d| d.id.clone()).collect(),
                embeddings: chunk.iter().map(|d| d.dense_vector.clone()).collect(),
                documents: chunk.iter().map(|d| d.dense_text.clone()).collect(),
                metadatas: chunk.iter().map(Self::doc_to_meta).collect(),
            };
            let resp = self
                .request_builder(
                    reqwest::Method::POST,
                    &format!("api/v1/collections/{col_id}/upsert"),
                )
                .json(&body)
                .send()
                .await?;
            if !resp.status().is_success() {
                let status = resp.status();
                let msg = resp.text().await.unwrap_or_default();
                return Err(anyhow::anyhow!("ChromaDB upsert failed {status}: {msg}"));
            }
        }
        Ok(())
    }

    async fn delete_by_source(&self, files: &[&str]) -> anyhow::Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let col_id = self.get_collection_id().await?;
        // Build $or filter for multiple files
        let conditions: Vec<Value> = files
            .iter()
            .map(|f| serde_json::json!({ "source_file": { "$eq": f } }))
            .collect();
        let where_clause = if conditions.len() == 1 {
            conditions.into_iter().next().unwrap()
        } else {
            serde_json::json!({ "$or": conditions })
        };
        let body = DeleteBody {
            r#where: where_clause,
        };
        let resp = self
            .request_builder(
                reqwest::Method::POST,
                &format!("api/v1/collections/{col_id}/delete"),
            )
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let msg = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("ChromaDB delete failed {status}: {msg}"));
        }
        Ok(())
    }

    async fn existing_hashes(&self, hashes: &[&str]) -> anyhow::Result<HashSet<String>> {
        if hashes.is_empty() {
            return Ok(HashSet::new());
        }
        let col_id = self.get_collection_id().await?;
        let body = GetBody {
            ids: hashes.iter().map(|s| s.to_string()).collect(),
            include: vec![],
        };
        let resp = self
            .request_builder(
                reqwest::Method::POST,
                &format!("api/v1/collections/{col_id}/get"),
            )
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Ok(HashSet::new());
        }
        let result: GetResponse = resp.json().await?;
        Ok(result.ids.into_iter().collect())
    }

    async fn current_state(&self) -> anyhow::Result<HashMap<String, String>> {
        let col_id = self.get_collection_id().await?;
        let mut map = HashMap::new();
        let mut offset = 0usize;
        const PAGE: usize = 1000;
        loop {
            let body = ScrollBody {
                limit: PAGE,
                offset: Some(offset),
                include: vec!["metadatas".to_string()],
            };
            let resp = self
                .request_builder(
                    reqwest::Method::POST,
                    &format!("api/v1/collections/{col_id}/get"),
                )
                .json(&body)
                .send()
                .await?;
            if !resp.status().is_success() {
                break;
            }
            let page: ScrollResponse = resp.json().await?;
            if page.ids.is_empty() {
                break;
            }
            let n = page.ids.len();
            if let Some(metas) = page.metadatas {
                for meta in &metas {
                    let sf = meta
                        .get("source_file")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let ch = meta
                        .get("commit_hash")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if !sf.is_empty() && !ch.is_empty() {
                        map.insert(sf.to_string(), ch.to_string());
                    }
                }
            }
            if n < PAGE {
                break;
            }
            offset += PAGE;
        }
        Ok(map)
    }

    async fn search(
        &self,
        query: &[f32],
        top_k: usize,
        _opts: SearchOptions,
    ) -> anyhow::Result<Vec<SearchResult>> {
        let col_id = self.get_collection_id().await?;
        let body = QueryBody {
            query_embeddings: vec![query.to_vec()],
            n_results: top_k,
            include: vec![
                "documents".to_string(),
                "metadatas".to_string(),
                "distances".to_string(),
            ],
        };
        let resp = self
            .request_builder(
                reqwest::Method::POST,
                &format!("api/v1/collections/{col_id}/query"),
            )
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let msg = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("ChromaDB query failed {status}: {msg}"));
        }
        let result: QueryResponse = resp.json().await?;

        let ids = result.ids.into_iter().next().unwrap_or_default();
        let distances = result
            .distances
            .and_then(|d| d.into_iter().next())
            .unwrap_or_default();
        let documents = result
            .documents
            .and_then(|d| d.into_iter().next())
            .unwrap_or_default();
        let metadatas = result
            .metadatas
            .and_then(|m| m.into_iter().next())
            .unwrap_or_default();

        let results = ids
            .into_iter()
            .enumerate()
            .map(|(i, id)| {
                let distance = distances.get(i).copied().unwrap_or(1.0);
                let dense_text = documents.get(i).cloned().unwrap_or_default();
                let meta = metadatas.get(i).cloned().unwrap_or_default();
                let source_file = meta
                    .get("source_file")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned);
                let sparse_text = meta
                    .get("sparse_text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let sparse_gen_id = meta
                    .get("sparse_text_generator_id")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned);
                let meta_gen_id = meta
                    .get("metadata_generator_id")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned);
                // Filter out system keys from metadata
                let system_keys = [
                    "source_file",
                    "commit_hash",
                    "dense_text_hash",
                    "sparse_text",
                    "sparse_text_generator_id",
                    "metadata_generator_id",
                ];
                let clean_meta: HashMap<String, Value> = meta
                    .into_iter()
                    .filter(|(k, _)| !system_keys.contains(&k.as_str()))
                    .collect();
                SearchResult {
                    id,
                    dense_text,
                    sparse_text,
                    metadata: clean_meta,
                    // Chroma returns cosine distance in [0,2]; convert to similarity in [0,1].
                    similarity: (1.0 - distance / 2.0) as f32,
                    source_file,
                    sparse_text_generator_id: sparse_gen_id,
                    metadata_generator_id: meta_gen_id,
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
    #[ignore = "requires ChromaDB running at http://localhost:8000"]
    async fn chromadb_init_and_upsert() {
        let col = format!(
            "test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        );
        let store = ChromaDbStore::new("http://localhost:8000", &col);
        store.initialize().await.unwrap();

        let docs = make_docs(10);
        store.upsert(&docs).await.unwrap();

        let query = vec![0.5f32; DIMS];
        let results = store
            .search(&query, 3, SearchOptions::default())
            .await
            .unwrap();
        assert!(!results.is_empty());

        let hashes: Vec<&str> = vec!["0000000000000000", "9999999999999999"];
        let found = store.existing_hashes(&hashes).await.unwrap();
        assert!(found.contains("0000000000000000"));
        assert!(!found.contains("9999999999999999"));

        store.delete_by_source(&["src/file_000.rs"]).await.unwrap();
    }
}
