//! JSON wire-format mirrors of the `VectorStore` payload types, matching exactly the shapes
//! `virage-plugin-lancedb`'s own `wire.rs` produces/consumes on the plugin side of this same ABI
//! (see that crate for the plugin-side half). Local mirrors rather than `serde` derives on
//! `stores::mod`'s real types, for the same reason the plugin crate chose that: avoids adding a
//! serialization concern to types that have never needed one before this dylib path existed.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::stores::{IndexMeta, SearchOptions, SearchResult, VectorDocument};

/// Wire form of `VectorDocument`, minus `dense_vector` (carried out-of-band as a raw buffer).
#[derive(Serialize)]
pub struct WireVectorDocument<'a> {
    pub id: &'a str,
    pub dense_text: &'a str,
    pub sparse_text: &'a str,
    pub dense_text_hash: &'a str,
    pub sparse_text_generator_id: &'a str,
    pub metadata_generator_id: &'a str,
    pub metadata: &'a HashMap<String, Value>,
    pub tags: &'a [String],
    pub source_file: &'a str,
    pub commit_hash: &'a str,
}

impl<'a> From<&'a VectorDocument> for WireVectorDocument<'a> {
    fn from(d: &'a VectorDocument) -> Self {
        WireVectorDocument {
            id: &d.id,
            dense_text: &d.dense_text,
            sparse_text: &d.sparse_text,
            dense_text_hash: &d.dense_text_hash,
            sparse_text_generator_id: &d.sparse_text_generator_id,
            metadata_generator_id: &d.metadata_generator_id,
            metadata: &d.metadata,
            tags: &d.tags,
            source_file: &d.source_file,
            commit_hash: &d.commit_hash,
        }
    }
}

pub fn docs_to_json(docs: &[VectorDocument]) -> serde_json::Result<String> {
    let wire: Vec<WireVectorDocument> = docs.iter().map(WireVectorDocument::from).collect();
    serde_json::to_string(&wire)
}

/// Wire form of `SearchOptions`.
#[derive(Serialize)]
pub struct WireSearchOptions<'a> {
    pub hybrid: bool,
    pub hybrid_alpha: f32,
    pub query_text: &'a Option<String>,
    pub filter: &'a Option<HashMap<String, Value>>,
    pub tag_filter: &'a Option<Vec<String>>,
}

impl<'a> From<&'a SearchOptions> for WireSearchOptions<'a> {
    fn from(o: &'a SearchOptions) -> Self {
        WireSearchOptions {
            hybrid: o.hybrid,
            hybrid_alpha: o.hybrid_alpha,
            query_text: &o.query_text,
            filter: &o.filter,
            tag_filter: &o.tag_filter,
        }
    }
}

/// Wire form of `SearchResult` — input direction only (parsed from a plugin response).
#[derive(Deserialize)]
pub struct WireSearchResult {
    pub id: String,
    pub dense_text: String,
    pub sparse_text: String,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
    pub similarity: f32,
    pub source_file: Option<String>,
    pub sparse_text_generator_id: Option<String>,
    pub metadata_generator_id: Option<String>,
}

impl From<WireSearchResult> for SearchResult {
    fn from(w: WireSearchResult) -> Self {
        SearchResult {
            id: w.id,
            dense_text: w.dense_text,
            sparse_text: w.sparse_text,
            metadata: w.metadata,
            similarity: w.similarity,
            source_file: w.source_file,
            sparse_text_generator_id: w.sparse_text_generator_id,
            metadata_generator_id: w.metadata_generator_id,
        }
    }
}

pub fn results_from_json(json: &str) -> anyhow::Result<Vec<SearchResult>> {
    let wire: Vec<WireSearchResult> = serde_json::from_str(json)?;
    Ok(wire.into_iter().map(SearchResult::from).collect())
}

/// Wire form of `IndexMeta` (both directions).
#[derive(Serialize, Deserialize)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_search_result() {
        let json = r#"[{
            "id": "abc",
            "dense_text": "hello",
            "sparse_text": "hello",
            "metadata": {"k": "v"},
            "similarity": 0.9,
            "source_file": "f.md",
            "sparse_text_generator_id": "g1",
            "metadata_generator_id": "g1"
        }]"#;
        let results = results_from_json(json).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "abc");
        assert!((results[0].similarity - 0.9).abs() < f32::EPSILON);
    }

    #[test]
    fn wire_vector_document_omits_dense_vector() {
        let doc = VectorDocument {
            id: "abc".into(),
            dense_text: "hello".into(),
            sparse_text: "hello".into(),
            dense_text_hash: "abc".into(),
            sparse_text_generator_id: "g1".into(),
            metadata_generator_id: "g1".into(),
            metadata: HashMap::new(),
            tags: vec![],
            dense_vector: vec![1.0, 2.0, 3.0],
            source_file: "f.md".into(),
            commit_hash: "h1".into(),
        };
        let json = docs_to_json(std::slice::from_ref(&doc)).unwrap();
        assert!(!json.contains("dense_vector"));
        assert!(json.contains("\"id\":\"abc\""));
    }

    #[test]
    fn index_meta_round_trips() {
        let meta = IndexMeta {
            model: "test-model".into(),
            dimensions: 384,
        };
        let wire: WireIndexMeta = (&meta).into();
        let json = serde_json::to_string(&wire).unwrap();
        let parsed: WireIndexMeta = serde_json::from_str(&json).unwrap();
        let back: IndexMeta = parsed.into();
        assert_eq!(back.model, meta.model);
        assert_eq!(back.dimensions, meta.dimensions);
    }
}
