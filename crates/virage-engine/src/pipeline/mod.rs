use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

pub use crate::chunkers::walk::ArtifactSet;

// ─── Pipeline types ───────────────────────────────────────────────────────────

/// A single file to be processed by the pipeline.
#[derive(Debug, Clone)]
pub struct WorkItem {
    /// File path (relative to source root).
    pub path: String,
    /// Stable content revision token (git blob SHA or content hash).
    pub revision: String,
    /// Tags applied by the index-time tag pipeline.
    pub tags: Vec<String>,
    /// Index into the `FileSetGroup` list this item was listed from — tells workers which
    /// source to read content from and which chunkers apply (ADR-043 per-fileSet scoping).
    pub group_idx: usize,
}

/// One fileSet's resolved source, filter, and per-format chunkers (ADR-043). `run_pipeline`
/// iterates over these instead of a single global source/chunker pair, so each fileSet's
/// `include`/`ignore`/`source` override actually scopes what gets walked and how it's chunked.
#[derive(Clone)]
pub struct FileSetGroup {
    pub source: Arc<dyn crate::sources::SourceProvider>,
    pub filter: Option<crate::sources::SourceFilter>,
    pub chunkers: Vec<Arc<dyn crate::chunkers::FileChunker>>,
    /// Tags applied to every item in this fileSet, in addition to whatever the source
    /// provider and `label_rules` contribute.
    pub tags: Vec<String>,
}

/// Whether fileSet-group revision keys need to be qualified by source name to avoid
/// collisions between distinct sources indexing files at the same relative path.
/// Single-source configs (the common case) keep bare-path keys so existing state-DB
/// entries and incremental indexing aren't invalidated by this qualifier.
pub fn groups_need_qualified_keys(groups: &[FileSetGroup]) -> bool {
    let mut names = std::collections::HashSet::new();
    for g in groups {
        names.insert(g.source.name());
    }
    names.len() > 1
}

/// Build the state-DB / known-revisions key for `path` under `source_name`, qualified only
/// when `qualify` (see `groups_need_qualified_keys`) is set.
pub fn revision_key(qualify: bool, source_name: &str, path: &str) -> String {
    if qualify {
        format!("{source_name}:{path}")
    } else {
        path.to_string()
    }
}

/// List every item across all `groups` (respecting each group's filter), returning
/// `(key, path, revision)` triples. Used by callers that only need path/revision state
/// (dry-run preview, post-index state-DB sync) rather than full `SourceItem`s.
pub async fn list_current_state(
    groups: &[FileSetGroup],
) -> anyhow::Result<Vec<(String, String, String)>> {
    use futures::StreamExt;

    let qualify = groups_need_qualified_keys(groups);
    let mut out = Vec::new();
    for group in groups {
        let mut stream = group.source.list_all(group.filter.clone());
        let mut paths = Vec::new();
        while let Some(item) = stream.next().await {
            paths.push(item?.path);
        }
        let path_refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let revs = group.source.file_revisions(&path_refs).await?;
        let source_name = group.source.name();
        for path in paths {
            let rev = revs.get(&path).cloned().unwrap_or_default();
            let key = revision_key(qualify, source_name, &path);
            out.push((key, path, rev));
        }
    }
    Ok(out)
}

/// Chunks produced by a worker for a single `WorkItem`.
///
/// ADR-057: a single `WorkItem` (file) may now produce *multiple* `WorkResult`s — one per
/// embedding micro-batch, sent as soon as that micro-batch is embedded rather than after the
/// whole file's chunks are embedded (`pipeline/worker.rs`'s streaming `process_item`). `is_final`
/// marks the last result for a given file, so the coordinator counts the file as done exactly
/// once (on the final result) while still forwarding every micro-batch's chunks toward the
/// store as they arrive.
#[derive(Debug)]
pub struct WorkResult {
    pub path: String,
    pub chunks: Vec<EmbeddedChunk>,
    pub is_final: bool,
}

/// An `ArtifactSet` with its dense embedding vector attached.
pub struct EmbeddedChunk {
    pub artifact: ArtifactSet,
    pub dense_vector: Vec<f32>,
}

impl std::fmt::Debug for EmbeddedChunk {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EmbeddedChunk")
            .field("dense_text_hash", &self.artifact.dense_text_hash)
            .field("dims", &self.dense_vector.len())
            .finish()
    }
}

pub mod concurrency;
pub mod coordinator;
pub mod worker;

pub use concurrency::{ConcurrencyStrategy, FixedWorkers, RamSampling};

// ─── PipelineConfig ───────────────────────────────────────────────────────────

/// Configuration for a single `run_pipeline` invocation.
#[derive(Clone)]
pub struct PipelineConfig {
    /// Number of parallel worker tokio tasks — the pre-ADR-057 default/fallback. Still used
    /// as the `FixedWorkers` count when `concurrency_strategy` is `None`, and as the upper
    /// bound `RamSampling` scales toward when it is `Some`.
    pub workers: usize,
    /// ADR-057: resource-aware worker-count strategy. `None` preserves the pre-ADR-057
    /// behavior — a constant `workers` count for the whole run (`FixedWorkers`). Callers that
    /// want `RamSampling`'s dynamic scale-down under memory pressure set this explicitly
    /// (`cli/index.rs`'s `cmd_index` wires this from `--workers`/config via `resolve_concurrency`).
    pub concurrency_strategy: Option<Arc<dyn ConcurrencyStrategy>>,
    /// Batch size for `VectorStore::upsert` calls.
    pub upload_batch_size: usize,
    /// Maximum tokens per chunk window.
    pub max_tokens: usize,
    /// Minimum tokens before merging a trailing short window.
    pub min_tokens: Option<usize>,
    /// Sliding-window overlap fraction.
    pub overlap: f32,
    /// Enable recursive segment pre-splitting.
    pub recursive: bool,
    /// Enable adaptive size halving for code/table-cell nodes.
    pub adaptive_size: bool,
    /// Strategy tag stored in chunk metadata.
    pub strategy: String,
    /// Sparse text method fingerprint (triggers FTS rebuild when changed).
    pub sparse_text_generator_id: String,
    /// Metadata method fingerprint (triggers re-enrichment when changed).
    pub metadata_generator_id: String,
    /// Optional live progress counters driven by the coordinator.
    pub progress: Option<Arc<ProgressCounters>>,
    /// Skip uploading to the vector store (index locally only).
    pub skip_upload: bool,
    /// Glob-matched tag rules (IR-037), applied to every item in addition to
    /// whatever the source provider yields (e.g. CODEOWNERS).
    pub label_rules: Vec<LabelRule>,
}

/// A single glob → tags rule (IR-037), independent of the `config` feature
/// (`pipeline` and `config` are enabled independently — see Cargo.toml — so this
/// type cannot depend on `crate::config`'s serde-derived counterpart). Callers that
/// parse `virage.config.json` (`config::LabelRule`) convert into this at the one
/// point both features are guaranteed present (`bin/virage.rs`, under `cli-binary`).
#[derive(Debug, Clone)]
pub struct LabelRule {
    pub pattern: String,
    pub add: Vec<String>,
}

impl std::fmt::Debug for PipelineConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PipelineConfig")
            .field("workers", &self.workers)
            .field(
                "concurrency_strategy",
                &self.concurrency_strategy.as_ref().map(|_| "Some(..)"),
            )
            .field("upload_batch_size", &self.upload_batch_size)
            .field("max_tokens", &self.max_tokens)
            .field("min_tokens", &self.min_tokens)
            .field("overlap", &self.overlap)
            .field("recursive", &self.recursive)
            .field("adaptive_size", &self.adaptive_size)
            .field("strategy", &self.strategy)
            .field("skip_upload", &self.skip_upload)
            .finish_non_exhaustive()
    }
}

impl Default for PipelineConfig {
    fn default() -> Self {
        let workers = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        Self {
            workers,
            concurrency_strategy: None,
            upload_batch_size: 64,
            max_tokens: 512,
            min_tokens: None,
            overlap: 0.0,
            recursive: false,
            adaptive_size: false,
            strategy: "window".into(),
            sparse_text_generator_id: String::new(),
            metadata_generator_id: String::new(),
            progress: None,
            skip_upload: false,
            label_rules: Vec::new(),
        }
    }
}

// ─── PipelineStats ────────────────────────────────────────────────────────────

/// Aggregate counters produced by a single pipeline run.
#[derive(Debug, Default)]
pub struct PipelineStats {
    pub files_processed: usize,
    pub files_skipped: usize,
    pub files_deleted: usize,
    pub chunks_upserted: usize,
    /// Sum of each upserted chunk's `estimatedTokens` metadata (set by the chunker in
    /// `chunkers::walk`). Used by `virage bench index` for a tokens/sec throughput figure.
    pub tokens_processed: usize,
    /// `revision_key → current revision` for every `to_process` file that *fully* completed
    /// (received a final `WorkResult`, ADR-057) this run. Callers should persist only these
    /// keys as "known" — a file whose embedding failed partway through (streaming can leave
    /// some of its chunks already stored) must NOT have its revision recorded, or it would
    /// never be retried on a subsequent run despite having incomplete/truncated content in the
    /// store. Deliberately excludes skipped files (their existing DB entry is already correct
    /// and doesn't need rewriting) and deleted files (handled separately via `list_current_state`
    /// diffing, unrelated to this run's processing outcome).
    pub processed_revisions: HashMap<String, String>,
}

// ─── ProgressCounters ────────────────────────────────────────────────────────

/// Shared atomic counters for real-time progress reporting.
#[derive(Debug, Default)]
pub struct ProgressCounters {
    pub total_files: AtomicUsize,
    pub queued: AtomicUsize,
    pub done: AtomicUsize,
    pub chunks: AtomicUsize,
}

impl ProgressCounters {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn set_total(&self, n: usize) {
        self.total_files.store(n, Ordering::Relaxed);
    }
    pub fn inc_queued(&self) {
        self.queued.fetch_add(1, Ordering::Relaxed);
    }
    pub fn inc_done(&self) {
        self.done.fetch_add(1, Ordering::Relaxed);
    }
    pub fn add_chunks(&self, n: usize) {
        self.chunks.fetch_add(n, Ordering::Relaxed);
    }
    pub fn snapshot(&self) -> (usize, usize, usize, usize) {
        (
            self.total_files.load(Ordering::Relaxed),
            self.queued.load(Ordering::Relaxed),
            self.done.load(Ordering::Relaxed),
            self.chunks.load(Ordering::Relaxed),
        )
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::*;
    use crate::embedders::Embedder;
    use crate::sources::{ByteRange, ChangedFiles, SourceFilter, SourceItem, SourceProvider};
    use crate::stores::{SearchOptions, SearchResult, VectorDocument, VectorStore};

    // ── Minimal mock implementations ─────────────────────────────────────────

    struct MockSource {
        items: Vec<SourceItem>,
    }

    #[async_trait::async_trait]
    impl SourceProvider for MockSource {
        fn name(&self) -> &str {
            "mock"
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
            let items: Vec<anyhow::Result<SourceItem>> = self
                .items
                .iter()
                .map(|i| {
                    Ok(SourceItem {
                        id: i.id.clone(),
                        path: i.path.clone(),
                        provider_name: i.provider_name.clone(),
                        tags: i.tags.clone(),
                        meta: i.meta.clone(),
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
            Ok(bytes::Bytes::from(format!("# Hello\n\nContent of {path}")))
        }
    }

    struct MockEmbedder {
        dims: usize,
    }

    impl Embedder for MockEmbedder {
        fn dimensions(&self) -> usize {
            self.dims
        }
        fn embed_batch(&mut self, texts: &[&str]) -> Result<Vec<f32>, String> {
            Ok(vec![0.1f32; texts.len() * self.dims])
        }
    }

    struct MockStore {
        upserted: std::sync::Mutex<Vec<VectorDocument>>,
    }
    impl MockStore {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                upserted: std::sync::Mutex::new(Vec::new()),
            })
        }
        fn upsert_count(&self) -> usize {
            self.upserted.lock().unwrap().len()
        }
    }

    #[async_trait::async_trait]
    impl VectorStore for MockStore {
        async fn initialize(&self) -> anyhow::Result<()> {
            Ok(())
        }
        async fn upsert(&self, docs: &[VectorDocument]) -> anyhow::Result<()> {
            self.upserted
                .lock()
                .unwrap()
                .extend(docs.iter().map(|d| VectorDocument {
                    id: d.id.clone(),
                    dense_text: d.dense_text.clone(),
                    sparse_text: d.sparse_text.clone(),
                    dense_text_hash: d.dense_text_hash.clone(),
                    sparse_text_generator_id: d.sparse_text_generator_id.clone(),
                    metadata_generator_id: d.metadata_generator_id.clone(),
                    metadata: d.metadata.clone(),
                    tags: d.tags.clone(),
                    dense_vector: d.dense_vector.clone(),
                    source_file: d.source_file.clone(),
                    commit_hash: d.commit_hash.clone(),
                }));
            Ok(())
        }
        async fn delete_by_source(&self, _files: &[&str]) -> anyhow::Result<()> {
            Ok(())
        }
        async fn existing_hashes(
            &self,
            _hashes: &[&str],
        ) -> anyhow::Result<std::collections::HashSet<String>> {
            Ok(std::collections::HashSet::new())
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

    // ── Tests ────────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn progress_counters_are_atomic() {
        let c = ProgressCounters::new();
        let c2 = c.clone();
        let handle = tokio::spawn(async move {
            for _ in 0..50 {
                c2.inc_done();
            }
        });
        for _ in 0..50 {
            c.inc_done();
        }
        handle.await.unwrap();
        let (_, _, done, _) = c.snapshot();
        assert_eq!(done, 100);
    }

    #[tokio::test]
    async fn pipeline_runs_on_mock_source() {
        let source = Arc::new(MockSource {
            items: vec![SourceItem {
                id: "f1".into(),
                path: "README.md".into(),
                provider_name: "mock".into(),
                tags: vec![],
                meta: HashMap::new(),
            }],
        });
        let store = MockStore::new();
        let embedder: Arc<std::sync::Mutex<dyn Embedder + Send>> =
            Arc::new(std::sync::Mutex::new(MockEmbedder { dims: 4 }));

        let config = PipelineConfig {
            workers: 1,
            upload_batch_size: 16,
            max_tokens: 512,
            strategy: "window".into(),
            sparse_text_generator_id: "gen_v1".into(),
            metadata_generator_id: "meta_v1".into(),
            ..Default::default()
        };

        let groups = vec![FileSetGroup {
            source,
            filter: None,
            chunkers: vec![], // no file-format chunkers; walker handles raw bytes via markdown fallback
            tags: vec![],
        }];
        let stats = coordinator::run_pipeline(
            &config,
            groups,
            embedder,
            store.clone(),
            HashMap::new(), // no known revisions → process everything
        )
        .await
        .unwrap();

        assert_eq!(stats.files_processed, 1);
        assert!(store.upsert_count() > 0, "expected chunks to be upserted");
        assert_eq!(
            stats.processed_revisions.get("README.md"),
            Some(&"rev1".to_string()),
            "a fully-processed file's revision should be recorded"
        );
    }

    /// Review fix (ADR-057): a file whose embedding fails partway through — some of its
    /// micro-batches already reached the store — must not have its revision recorded, or
    /// `cli/index.rs`'s state-DB update would mark it "known" and it would never be retried
    /// despite the store holding incomplete/truncated content for it.
    #[tokio::test]
    async fn pipeline_excludes_partially_failed_file_from_processed_revisions() {
        struct ManyParagraphSource {
            items: Vec<SourceItem>,
        }

        #[async_trait::async_trait]
        impl SourceProvider for ManyParagraphSource {
            fn name(&self) -> &str {
                "many-paragraph-mock"
            }
            fn provider_type(&self) -> &str {
                "mock"
            }
            async fn current_revision(&self) -> anyhow::Result<String> {
                Ok("rev1".into())
            }
            async fn file_revisions(
                &self,
                paths: &[&str],
            ) -> anyhow::Result<HashMap<String, String>> {
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
                let items: Vec<anyhow::Result<SourceItem>> = self
                    .items
                    .iter()
                    .map(|i| {
                        Ok(SourceItem {
                            id: i.id.clone(),
                            path: i.path.clone(),
                            provider_name: i.provider_name.clone(),
                            tags: i.tags.clone(),
                            meta: i.meta.clone(),
                        })
                    })
                    .collect();
                Box::pin(futures::stream::iter(items))
            }
            async fn read_content(
                &self,
                _path: &str,
                _range: Option<ByteRange>,
            ) -> anyhow::Result<bytes::Bytes> {
                // 20 paragraphs → 20 artifacts (min_tokens: Some(0) below disables merging) —
                // enough to span multiple embed_batch micro-batches regardless of whether the
                // 4-per-batch (low-memory) or 16-per-batch floor is active.
                let paragraphs: Vec<String> = (0..20)
                    .map(|i| format!("Paragraph {i} content here."))
                    .collect();
                Ok(bytes::Bytes::from(paragraphs.join("\n\n")))
            }
        }

        struct FailAfterNCallsEmbedder {
            dims: usize,
            calls: usize,
            fail_on_call: usize,
        }
        impl Embedder for FailAfterNCallsEmbedder {
            fn dimensions(&self) -> usize {
                self.dims
            }
            fn embed_batch(&mut self, texts: &[&str]) -> Result<Vec<f32>, String> {
                self.calls += 1;
                if self.calls == self.fail_on_call {
                    return Err("simulated failure mid-file".into());
                }
                Ok(vec![0.1f32; texts.len() * self.dims])
            }
        }

        let source = Arc::new(ManyParagraphSource {
            items: vec![SourceItem {
                id: "f1".into(),
                path: "big.md".into(),
                provider_name: "mock".into(),
                tags: vec![],
                meta: HashMap::new(),
            }],
        });
        let store = MockStore::new();
        let embedder: Arc<std::sync::Mutex<dyn Embedder + Send>> =
            Arc::new(std::sync::Mutex::new(FailAfterNCallsEmbedder {
                dims: 4,
                calls: 0,
                fail_on_call: 2,
            }));

        let config = PipelineConfig {
            workers: 1,
            upload_batch_size: 4,
            // Small enough that every paragraph exceeds it on its own — walk_to_chunks hard-cuts
            // each oversized segment into its own window (see walk.rs's "Hard-cut a single
            // oversized segment" branch), guaranteeing one artifact per paragraph (20 total)
            // instead of greedily packing all of them into a single window.
            max_tokens: 4,
            min_tokens: Some(0),
            strategy: "window".into(),
            sparse_text_generator_id: "gen_v1".into(),
            metadata_generator_id: "meta_v1".into(),
            ..Default::default()
        };

        let groups = vec![FileSetGroup {
            source,
            filter: None,
            chunkers: vec![],
            tags: vec![],
        }];
        let stats =
            coordinator::run_pipeline(&config, groups, embedder, store.clone(), HashMap::new())
                .await
                .unwrap();

        assert!(
            store.upsert_count() > 0,
            "the first micro-batch's chunks should have reached the store before the second failed"
        );
        assert!(
            stats.processed_revisions.is_empty(),
            "a partially-failed file must not have its revision recorded — got {:?}",
            stats.processed_revisions
        );
        assert_eq!(
            stats.files_processed, 0,
            "a partially-failed file must not count as processed"
        );
    }

    #[tokio::test]
    async fn label_rules_add_matching_tags() {
        let source = Arc::new(MockSource {
            items: vec![
                SourceItem {
                    id: "f1".into(),
                    path: "packages/project1/README.md".into(),
                    provider_name: "mock".into(),
                    tags: vec!["team:core".into()],
                    meta: HashMap::new(),
                },
                SourceItem {
                    id: "f2".into(),
                    path: "packages/other/README.md".into(),
                    provider_name: "mock".into(),
                    tags: vec![],
                    meta: HashMap::new(),
                },
            ],
        });
        let store = MockStore::new();
        let embedder: Arc<std::sync::Mutex<dyn Embedder + Send>> =
            Arc::new(std::sync::Mutex::new(MockEmbedder { dims: 4 }));

        let config = PipelineConfig {
            workers: 1,
            upload_batch_size: 16,
            max_tokens: 512,
            strategy: "window".into(),
            sparse_text_generator_id: "gen_v1".into(),
            metadata_generator_id: "meta_v1".into(),
            label_rules: vec![LabelRule {
                pattern: "packages/project1/**".into(),
                add: vec!["ns:acme-corp".into(), "project:project1".into()],
            }],
            ..Default::default()
        };

        let groups = vec![FileSetGroup {
            source,
            filter: None,
            chunkers: vec![],
            tags: vec![],
        }];
        coordinator::run_pipeline(&config, groups, embedder, store.clone(), HashMap::new())
            .await
            .unwrap();

        let docs = store.upserted.lock().unwrap();
        let project1_doc = docs
            .iter()
            .find(|d| d.source_file == "packages/project1/README.md")
            .expect("expected a chunk from the matched file");
        assert!(project1_doc.tags.contains(&"ns:acme-corp".to_string()));
        assert!(project1_doc.tags.contains(&"project:project1".to_string()));
        assert!(project1_doc.tags.contains(&"team:core".to_string()));

        let other_doc = docs
            .iter()
            .find(|d| d.source_file == "packages/other/README.md")
            .expect("expected a chunk from the unmatched file");
        assert!(!other_doc.tags.contains(&"ns:acme-corp".to_string()));
    }
}
