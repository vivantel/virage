//! JSON wire-format mirrors of `virage_engine::stores` types.
//!
//! CE's `VectorStore` payload types (`VectorDocument`, `SearchOptions`,
//! `SearchResult`, `IndexMeta`) don't derive `serde::{Serialize,Deserialize}`
//! — they're internal to the CE monolith and have never needed to cross a
//! process/ABI boundary before. Per IR-050 Phase 2's "wrap, don't move"
//! preference, this crate keeps CE's `stores/mod.rs` untouched and instead
//! defines local wire structs that mirror the field shape, with explicit
//! conversions both ways. Dense vectors are never carried on these wire
//! structs — they always cross the FFI boundary as a separate raw
//! `(*const f32, usize)` pair (see `StoreVTable`'s docs on the dylib-plugin
//! host side).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use virage_engine::stores::{IndexMeta, SearchOptions, SearchResult, VectorDocument};

/// Wire form of `VectorDocument`, minus `dense_vector` (carried out-of-band).
#[derive(Debug, Deserialize)]
pub struct WireVectorDocument {
    pub id: String,
    pub dense_text: String,
    pub sparse_text: String,
    pub dense_text_hash: String,
    pub sparse_text_generator_id: String,
    pub metadata_generator_id: String,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub source_file: String,
    pub commit_hash: String,
}

impl WireVectorDocument {
    /// Reattach a dense vector slice to produce a real `VectorDocument`.
    pub fn into_document(self, dense_vector: Vec<f32>) -> VectorDocument {
        VectorDocument {
            id: self.id,
            dense_text: self.dense_text,
            sparse_text: self.sparse_text,
            dense_text_hash: self.dense_text_hash,
            sparse_text_generator_id: self.sparse_text_generator_id,
            metadata_generator_id: self.metadata_generator_id,
            metadata: self.metadata,
            tags: self.tags,
            dense_vector,
            source_file: self.source_file,
            commit_hash: self.commit_hash,
        }
    }
}

/// Wire form of `SearchOptions`.
#[derive(Debug, Deserialize)]
#[serde(default)]
pub struct WireSearchOptions {
    pub hybrid: bool,
    pub hybrid_alpha: f32,
    pub query_text: Option<String>,
    pub filter: Option<HashMap<String, Value>>,
    pub tag_filter: Option<Vec<String>>,
}

impl Default for WireSearchOptions {
    fn default() -> Self {
        let d = SearchOptions::default();
        Self {
            hybrid: d.hybrid,
            hybrid_alpha: d.hybrid_alpha,
            query_text: d.query_text,
            filter: d.filter,
            tag_filter: d.tag_filter,
        }
    }
}

impl From<WireSearchOptions> for SearchOptions {
    fn from(w: WireSearchOptions) -> Self {
        SearchOptions {
            hybrid: w.hybrid,
            hybrid_alpha: w.hybrid_alpha,
            query_text: w.query_text,
            filter: w.filter,
            tag_filter: w.tag_filter,
        }
    }
}

/// Wire form of `SearchResult` — output direction only.
#[derive(Debug, Serialize)]
pub struct WireSearchResult {
    pub id: String,
    pub dense_text: String,
    pub sparse_text: String,
    pub metadata: HashMap<String, Value>,
    pub similarity: f32,
    pub source_file: Option<String>,
    pub sparse_text_generator_id: Option<String>,
    pub metadata_generator_id: Option<String>,
}

impl From<&SearchResult> for WireSearchResult {
    fn from(r: &SearchResult) -> Self {
        WireSearchResult {
            id: r.id.clone(),
            dense_text: r.dense_text.clone(),
            sparse_text: r.sparse_text.clone(),
            metadata: r.metadata.clone(),
            similarity: r.similarity,
            source_file: r.source_file.clone(),
            sparse_text_generator_id: r.sparse_text_generator_id.clone(),
            metadata_generator_id: r.metadata_generator_id.clone(),
        }
    }
}

pub fn results_to_json(results: &[SearchResult]) -> serde_json::Result<String> {
    let wire: Vec<WireSearchResult> = results.iter().map(WireSearchResult::from).collect();
    serde_json::to_string(&wire)
}

/// Wire form of `IndexMeta` (both directions — `read_meta` output, `write_meta` input).
#[derive(Debug, Serialize, Deserialize)]
pub struct WireIndexMeta {
    pub model: String,
    pub dimensions: usize,
}

impl From<&IndexMeta> for WireIndexMeta {
    fn from(m: &IndexMeta) -> Self {
        WireIndexMeta {
            model: m.model.clone(),
            dimensions: m.dimensions,
        }
    }
}

impl From<WireIndexMeta> for IndexMeta {
    fn from(w: WireIndexMeta) -> Self {
        IndexMeta {
            model: w.model,
            dimensions: w.dimensions,
        }
    }
}

/// `virage_store_create`'s `config_json` shape: enough to build a `LanceDbStore`.
#[derive(Debug, Deserialize)]
pub struct WireStoreConfig {
    pub uri: String,
    pub table_name: String,
    pub dimensions: usize,
}
