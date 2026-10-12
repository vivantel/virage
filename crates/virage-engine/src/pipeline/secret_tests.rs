//! Pipeline-level tests for the pre-index secret scan: a file with a finding is skipped, its
//! earlier chunks are removed from the store, and the finding never reaches the store or the
//! stats. The fake token is assembled at runtime so no source line holds a contiguous
//! credential-shaped string.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use super::*;
use crate::embedders::Embedder;
use crate::sources::{ByteRange, ChangedFiles, SourceFilter, SourceItem, SourceProvider};
use crate::stores::{SearchOptions, SearchResult, VectorDocument, VectorStore};

fn fake_token() -> String {
    let tail: String = "aB3dE5fG7hJ9kLmN2pQrS4tUvW6xYz01"
        .chars()
        .cycle()
        .take(36)
        .collect();
    format!("{}{}{}", "gh", "p_", tail)
}

struct TwoFileSource;

#[async_trait::async_trait]
impl SourceProvider for TwoFileSource {
    fn name(&self) -> &str {
        "two-file"
    }
    fn provider_type(&self) -> &str {
        "mock"
    }
    async fn current_revision(&self) -> anyhow::Result<String> {
        Ok("rev1".into())
    }
    async fn file_revisions(&self, paths: &[&str]) -> anyhow::Result<HashMap<String, String>> {
        Ok(paths
            .iter()
            .map(|p| (p.to_string(), "rev1".into()))
            .collect())
    }
    async fn changed_since(&self, _rev: &str) -> anyhow::Result<Option<ChangedFiles>> {
        Ok(None)
    }
    fn list_all(
        &self,
        _filter: Option<SourceFilter>,
    ) -> futures::stream::BoxStream<'_, anyhow::Result<SourceItem>> {
        let items: Vec<anyhow::Result<SourceItem>> = ["clean.md", "leaky.md"]
            .iter()
            .map(|p| {
                Ok(SourceItem {
                    id: p.to_string(),
                    path: p.to_string(),
                    provider_name: "two-file".into(),
                    tags: vec![],
                    meta: HashMap::new(),
                })
            })
            .collect();
        Box::pin(futures::stream::iter(items))
    }
    async fn read_content(
        &self,
        path: &str,
        _range: Option<ByteRange>,
    ) -> anyhow::Result<bytes::Bytes> {
        let body = if path == "leaky.md" {
            format!("# Notes\n\nthe deploy token is {}\n", fake_token())
        } else {
            "# Notes\n\nnothing sensitive in this file\n".to_string()
        };
        Ok(bytes::Bytes::from(body))
    }
}

struct FixedEmbedder;

impl Embedder for FixedEmbedder {
    fn dimensions(&self) -> usize {
        4
    }
    fn embed_batch(&mut self, texts: &[&str]) -> Result<Vec<f32>, String> {
        Ok(vec![0.1f32; texts.len() * 4])
    }
}

#[derive(Default)]
struct RecordingStore {
    upserted_sources: Mutex<Vec<String>>,
    upserted_text: Mutex<Vec<String>>,
    deleted: Mutex<Vec<String>>,
}

#[async_trait::async_trait]
impl VectorStore for RecordingStore {
    async fn initialize(&self) -> anyhow::Result<()> {
        Ok(())
    }
    async fn upsert(&self, docs: &[VectorDocument]) -> anyhow::Result<()> {
        for d in docs {
            self.upserted_sources
                .lock()
                .unwrap()
                .push(format!("{:?}", d.source_file));
            self.upserted_text
                .lock()
                .unwrap()
                .push(d.dense_text.clone());
        }
        Ok(())
    }
    async fn delete_by_source(&self, files: &[&str]) -> anyhow::Result<()> {
        self.deleted
            .lock()
            .unwrap()
            .extend(files.iter().map(|f| f.to_string()));
        Ok(())
    }
    async fn existing_hashes(&self, _hashes: &[&str]) -> anyhow::Result<HashSet<String>> {
        Ok(HashSet::new())
    }
    async fn current_state(&self) -> anyhow::Result<HashMap<String, String>> {
        Ok(HashMap::new())
    }
    async fn search(
        &self,
        _query: &[f32],
        _top_k: usize,
        _opts: SearchOptions,
    ) -> anyhow::Result<Vec<SearchResult>> {
        Ok(Vec::new())
    }
}

async fn run(secret_scan: bool) -> (PipelineStats, Arc<RecordingStore>) {
    let store = Arc::new(RecordingStore::default());
    let embedder: Arc<Mutex<dyn Embedder + Send>> = Arc::new(Mutex::new(FixedEmbedder));
    let config = PipelineConfig {
        workers: 1,
        upload_batch_size: 16,
        max_tokens: 512,
        strategy: "window".into(),
        sparse_text_generator_id: "gen_v1".into(),
        metadata_generator_id: "meta_v1".into(),
        secret_scan,
        ..Default::default()
    };
    let groups = vec![FileSetGroup {
        source: Arc::new(TwoFileSource),
        filter: None,
        chunkers: vec![],
        tags: vec![],
    }];
    let stats = coordinator::run_pipeline(&config, groups, embedder, store.clone(), HashMap::new())
        .await
        .unwrap();
    (stats, store)
}

#[tokio::test]
async fn file_with_a_finding_is_skipped_and_purged() {
    let (stats, store) = run(true).await;

    assert_eq!(stats.secret_skipped, vec!["leaky.md".to_string()]);
    // Both files complete (the skipped one with zero chunks), so both revisions are recorded.
    assert_eq!(stats.files_processed, 2);

    let sources = store.upserted_sources.lock().unwrap().join(" ");
    assert!(sources.contains("clean.md"));
    assert!(!sources.contains("leaky.md"));

    // Nothing the scanner matched reached the store.
    let token = fake_token();
    assert!(store
        .upserted_text
        .lock()
        .unwrap()
        .iter()
        .all(|t| !t.contains(&token)));

    // Earlier chunks of the skipped file are removed.
    assert_eq!(*store.deleted.lock().unwrap(), vec!["leaky.md".to_string()]);
}

#[tokio::test]
async fn scan_is_off_by_default() {
    let (stats, store) = run(false).await;

    assert!(stats.secret_skipped.is_empty());
    let sources = store.upserted_sources.lock().unwrap().join(" ");
    assert!(sources.contains("clean.md"));
    assert!(sources.contains("leaky.md"));
    assert!(store.deleted.lock().unwrap().is_empty());
}
