use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use serde_json::Value;

// ─── Shared document types ────────────────────────────────────────────────────

/// A document to upsert into a vector store.
pub struct VectorDocument {
    /// Unique ID — typically `denseTextHash` (16-char hex).
    pub id: String,
    pub dense_text: String,
    pub sparse_text: String,
    pub dense_text_hash: String,
    pub sparse_text_generator_id: String,
    pub metadata_generator_id: String,
    pub metadata: HashMap<String, Value>,
    pub tags: Vec<String>,
    /// Dense embedding vector (`f32`).
    pub dense_vector: Vec<f32>,
    pub source_file: String,
    pub commit_hash: String,
}

/// Options controlling similarity search behaviour.
pub struct SearchOptions {
    /// Enable hybrid (vector + BM25) search. Requires `query_text`. Default: false.
    pub hybrid: bool,
    /// Weight for hybrid blend: 0 = pure BM25, 1 = pure vector. Default: 0.6.
    pub hybrid_alpha: f32,
    /// Raw query text for BM25 side of hybrid search.
    pub query_text: Option<String>,
    /// Metadata key-value post-filter.
    pub filter: Option<HashMap<String, Value>>,
    /// Tag allowlist (ADR-046). `None` = no tag filtering.
    pub tag_filter: Option<Vec<String>>,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            hybrid: false,
            hybrid_alpha: 0.6,
            query_text: None,
            filter: None,
            tag_filter: None,
        }
    }
}

/// A single search result returned by `VectorStore::search`.
pub struct SearchResult {
    pub id: String,
    pub dense_text: String,
    pub sparse_text: String,
    pub metadata: HashMap<String, Value>,
    /// Cosine similarity in [0, 1].
    pub similarity: f32,
    pub source_file: Option<String>,
    pub sparse_text_generator_id: Option<String>,
    pub metadata_generator_id: Option<String>,
}

// ─── VectorStore trait ────────────────────────────────────────────────────────

/// CE extension point for vector storage (ADR-049).
///
/// Implementations: `LanceDbStore`, `QdrantStore`, `PostgresStore`, `ChromaDbStore`.
/// EE store adapters (S3-backed LanceDB, managed Qdrant) live in `virage-engine-ee` (Phase 8).
#[async_trait]
pub trait VectorStore: Send + Sync {
    /// Initialise schema, indexes, and connections.
    async fn initialize(&self) -> anyhow::Result<()>;
    /// Insert or update documents (upsert by `id`).
    async fn upsert(&self, docs: &[VectorDocument]) -> anyhow::Result<()>;
    /// Delete all documents whose `source_file` is in `files`.
    async fn delete_by_source(&self, files: &[&str]) -> anyhow::Result<()>;
    /// Return the subset of `hashes` that are already stored (dedup gate).
    async fn existing_hashes(&self, hashes: &[&str]) -> anyhow::Result<HashSet<String>>;
    /// Return `source_file → commit_hash` map for change detection.
    async fn current_state(&self) -> anyhow::Result<HashMap<String, String>>;
    /// ANN search for `query` vector, returning up to `top_k` results.
    async fn search(
        &self,
        query: &[f32],
        top_k: usize,
        opts: SearchOptions,
    ) -> anyhow::Result<Vec<SearchResult>>;
}

#[cfg(feature = "store-chromadb")]
pub mod chromadb;
#[cfg(feature = "store-lancedb")]
pub mod lancedb;
#[cfg(feature = "store-postgres")]
pub mod postgres;
#[cfg(feature = "store-qdrant")]
pub mod qdrant;
