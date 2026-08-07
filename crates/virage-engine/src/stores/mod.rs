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

// ─── Tag validation ────────────────────────────────────────────────────────────

/// Allow-list validation for tag values before they enter any store filter
/// expression: `^[a-z0-9][a-z0-9\-_:]{0,63}$`. Guards against injection into
/// backend-specific filter syntax (SQL, LanceDB `.only_if`, Qdrant filter DSL, ...).
pub fn is_valid_tag(tag: &str) -> bool {
    let mut chars = tag.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return false;
    }
    if tag.len() > 64 {
        return false;
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | ':'))
}

/// Reject the whole filter if any tag fails validation, rather than silently
/// dropping the invalid ones.
pub fn validate_tag_filter(tag_filter: &[String]) -> anyhow::Result<()> {
    for tag in tag_filter {
        if !is_valid_tag(tag) {
            anyhow::bail!("invalid tag: {tag:?}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tag_tests {
    use super::*;

    #[test]
    fn accepts_canonical_tags() {
        assert!(is_valid_tag("ns:acme-corp"));
        assert!(is_valid_tag("team:payments"));
        assert!(is_valid_tag("0abc_def"));
    }

    #[test]
    fn rejects_injection_shaped_tags() {
        assert!(!is_valid_tag(""));
        assert!(!is_valid_tag("Ns:acme"));
        assert!(!is_valid_tag("-leading-dash"));
        assert!(!is_valid_tag("a'); DROP TABLE chunks;--"));
        assert!(!is_valid_tag(&"a".repeat(65)));
        assert!(validate_tag_filter(&["ok".into(), "NOT OK".into()]).is_err());
    }
}

// ─── Index metadata ───────────────────────────────────────────────────────────

/// Metadata stored alongside a vector index describing how it was built.
pub struct IndexMeta {
    /// Embedder package or builtin key used to build the index.
    pub model: String,
    /// Vector dimensionality.
    pub dimensions: usize,
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
    /// Return every stored document, for tooling that needs a full scan (`virage quality
    /// run`, IR-038). `Ok(None)` means this store doesn't support a full scan — callers
    /// must treat that as "quality assessment unsupported on this backend", not an error.
    async fn list_all(&self) -> anyhow::Result<Option<Vec<SearchResult>>> {
        Ok(None)
    }
    /// Read index metadata stored at last `virage index` run. Returns `None` if unavailable.
    async fn read_meta(&self) -> anyhow::Result<Option<IndexMeta>> {
        Ok(None)
    }
    /// Write index metadata after a successful index run.
    async fn write_meta(&self, _meta: &IndexMeta) -> anyhow::Result<()> {
        Ok(())
    }
}

#[cfg(feature = "store-chromadb")]
pub mod chromadb;
#[cfg(feature = "store-lancedb")]
pub mod lancedb;
#[cfg(feature = "store-postgres")]
pub mod postgres;
#[cfg(feature = "store-qdrant")]
pub mod qdrant;
