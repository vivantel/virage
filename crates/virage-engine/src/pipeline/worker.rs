use std::sync::Arc;

use bytes::Bytes;
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;
use virage_vidoc::{DocNode, DocNodeAttrs, DocNodeType};

use super::{ArtifactSet, EmbeddedChunk, WorkItem, WorkResult};
use crate::chunkers::walk::{walk_to_chunks, WalkOptions};
use crate::embedders::Embedder;
use crate::sources::SourceProvider;

use super::{ConcurrencyStrategy, PipelineConfig, ProgressCounters};

/// A group's source + chunkers, stripped of the `filter`/`tags` already consumed by the
/// coordinator when listing items — all a worker needs to read and chunk a `WorkItem`.
pub struct GroupRuntime {
    pub source: Arc<dyn SourceProvider>,
    pub chunkers: Vec<Arc<dyn crate::chunkers::FileChunker>>,
}

/// How often an idle-gated worker re-checks whether it should resume pulling work (ADR-057).
/// Chosen as a few-second cadence: responsive enough to react to a memory spike well before a
/// handful more workers' embedding batches could compound it, without adding meaningful
/// overhead (`ConcurrencyStrategy::current_workers` is a cheap `sysinfo` refresh, not I/O).
pub const CONCURRENCY_SAMPLE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

/// Worker task: pulls `WorkItem`s, reads + chunks + embeds content, pushes `WorkResult`s.
///
/// `idx` is this worker's slot (0..ceiling, see `coordinator.rs`). Before pulling each item,
/// the worker checks `strategy.current_workers()`: if `idx >= current_workers`, it sits out —
/// sleeps `CONCURRENCY_SAMPLE_INTERVAL` and re-checks — instead of blocking on `recv()`, so a
/// memory-pressured run gracefully narrows down to its lowest-indexed workers (down to 1 under
/// real pressure) without ever cancelling an in-flight item.
///
/// While gated, the worker never touches `work_rx` at all — pulling from the shared receiver
/// (even non-blocking `try_recv()`) risks grabbing a real item out from under the throttle,
/// which would make gating cosmetic under any real backlog (a gated worker only sits idle once
/// the queue happens to run dry — i.e. right when the throttle matters least). Instead it polls
/// `feeder_done` — set by `coordinator.rs`'s feed task once every item has been sent — to detect
/// "no more work is coming" and exit without ever reaching into the channel.
#[allow(clippy::too_many_arguments)]
pub async fn worker_task(
    idx: usize,
    groups: Arc<Vec<GroupRuntime>>,
    embedder: Arc<std::sync::Mutex<dyn Embedder + Send>>,
    work_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<WorkItem>>>,
    result_tx: mpsc::Sender<WorkResult>,
    config: &PipelineConfig,
    progress: Arc<ProgressCounters>,
    strategy: Arc<dyn ConcurrencyStrategy>,
    feeder_done: Arc<std::sync::atomic::AtomicBool>,
) -> anyhow::Result<()> {
    loop {
        if idx >= strategy.current_workers() {
            if feeder_done.load(std::sync::atomic::Ordering::Acquire) {
                break; // no more work will ever arrive — nothing left to gate on
            }
            tokio::time::sleep(CONCURRENCY_SAMPLE_INTERVAL).await;
            continue;
        }

        let item = {
            let mut rx = work_rx.lock().await;
            rx.recv().await
        };
        let item = match item {
            Some(i) => i,
            None => break, // channel closed — no more work
        };

        let artifacts = match parse_and_chunk(&item, &groups, config).await {
            Ok(a) => a,
            Err(e) => {
                // Log but don't abort — skip this file. No `WorkResult` is sent for it, so the
                // coordinator never counts it — this is its only `inc_done()`.
                tracing::warn!(path = ?item.path, error = %e, "worker skipped file");
                progress.inc_done();
                continue;
            }
        };

        // ADR-057: embed and send in micro-batches as each is ready, rather than embedding the
        // whole file's artifacts in one call and returning one fully-materialized WorkResult.
        // `stream_embed_and_send` handles the empty-artifacts case and `is_final` bookkeeping —
        // see its doc comment.
        match stream_embed_and_send(
            &item, artifacts, &embedder, &result_tx, &progress, &strategy,
        )
        .await
        {
            Ok(()) => {}
            Err(SendFailed) => break, // coordinator dropped result channel
        }
    }
    Ok(())
}

/// Marker error: the coordinator's result channel is closed. Not an `anyhow::Error` — this
/// isn't a per-file failure, it's "stop the whole worker", handled by breaking the outer loop.
struct SendFailed;

/// Default micro-batch size: how many texts go into a single `Embedder::embed_batch` call. This
/// is independent of `PipelineConfig::upload_batch_size`, which bounds how many chunks
/// accumulate before the coordinator calls `store.upsert()` (a full Lance manifest commit, so
/// it still needs its own, larger floor to avoid a commit storm).
const EMBED_MICRO_BATCH_SIZE: usize = 16;

/// Micro-batch size used when `ConcurrencyStrategy` has throttled down to its floor (1 active
/// worker) — the clearest signal available that memory is genuinely tight. Smaller than
/// `EMBED_MICRO_BATCH_SIZE` so a single in-flight `embed_batch` call under real pressure stays
/// proportionally smaller too, instead of worker-count and batch-size throttling operating on
/// entirely independent knobs.
const LOW_MEMORY_MICRO_BATCH_SIZE: usize = 4;

/// Embeds `artifacts` in micro-batches and sends one `WorkResult` per micro-batch as soon as
/// it's embedded — chunks reach the coordinator's upsert batch incrementally instead of only
/// after the whole file is fully embedded (ADR-057 Decision 1).
///
/// Every data-carrying `WorkResult` sent from this function has `is_final: false`; a separate,
/// empty `is_final: true` marker is sent only once the whole file has been embedded
/// successfully — this keeps the "did this file fully succeed" signal (which the coordinator
/// uses to count `files_processed`) independent of "how many micro-batches did it take". If a
/// micro-batch fails to embed, the file's remaining artifacts are skipped (matching the
/// pre-streaming, whole-file-embed behavior) and **no** final marker is sent — the coordinator
/// never counts this file as processed, same as a `parse_and_chunk` failure.
async fn stream_embed_and_send(
    item: &WorkItem,
    artifacts: Vec<ArtifactSet>,
    embedder: &Arc<std::sync::Mutex<dyn Embedder + Send>>,
    result_tx: &mpsc::Sender<WorkResult>,
    progress: &ProgressCounters,
    strategy: &Arc<dyn ConcurrencyStrategy>,
) -> Result<(), SendFailed> {
    if artifacts.is_empty() {
        let result = WorkResult {
            path: item.path.clone(),
            chunks: Vec::new(),
            is_final: true,
        };
        return result_tx.send(result).await.map_err(|_| SendFailed);
    }

    let micro_batch_size = if strategy.current_workers() <= 1 {
        LOW_MEMORY_MICRO_BATCH_SIZE
    } else {
        EMBED_MICRO_BATCH_SIZE
    };

    let dims = match embedder
        .lock()
        .map_err(|e| anyhow::anyhow!("embedder lock poisoned: {e}"))
    {
        Ok(guard) => guard.dimensions(),
        Err(e) => {
            tracing::warn!(path = ?item.path, error = %e, "embedder lock poisoned — skipping file");
            progress.inc_done();
            return Ok(());
        }
    };

    let mut artifacts_iter = artifacts.into_iter();
    loop {
        let micro_batch: Vec<ArtifactSet> =
            artifacts_iter.by_ref().take(micro_batch_size).collect();
        if micro_batch.is_empty() {
            break;
        }

        let embedded = match embed_micro_batch(micro_batch, embedder, dims) {
            Ok(chunks) => chunks,
            Err(e) => {
                // Stop processing the rest of this file — matches the pre-streaming behavior of
                // a whole-file embed_batch() failure. Chunks from already-sent micro-batches for
                // this file have already reached the coordinator and are not retracted, but no
                // `is_final` marker follows, so the coordinator never counts this file as
                // successfully processed.
                tracing::warn!(path = ?item.path, error = %e, "embed_batch failed — skipping rest of file");
                progress.inc_done();
                return Ok(());
            }
        };

        let result = WorkResult {
            path: item.path.clone(),
            chunks: embedded,
            is_final: false,
        };
        result_tx.send(result).await.map_err(|_| SendFailed)?;
    }

    let done = WorkResult {
        path: item.path.clone(),
        chunks: Vec::new(),
        is_final: true,
    };
    result_tx.send(done).await.map_err(|_| SendFailed)
}

/// Embed one micro-batch of already-chunked artifacts. `dims` is resolved once by the caller
/// (constant for the whole run) rather than re-locking the shared embedder mutex per
/// micro-batch just to read it. Borrows each `dense_text` for the embed call instead of cloning
/// it — `Embedder::embed_batch` takes `&[&str]` specifically so this doesn't need to (see its
/// doc comment); the borrow ends before `artifacts` is consumed into `EmbeddedChunk`s below.
fn embed_micro_batch(
    artifacts: Vec<ArtifactSet>,
    embedder: &Arc<std::sync::Mutex<dyn Embedder + Send>>,
    dims: usize,
) -> anyhow::Result<Vec<EmbeddedChunk>> {
    let texts: Vec<&str> = artifacts.iter().map(|a| a.dense_text.as_str()).collect();
    let flat: Vec<f32> = {
        let mut emb = embedder
            .lock()
            .map_err(|e| anyhow::anyhow!("embedder lock poisoned: {e}"))?;
        emb.embed_batch(&texts)
            .map_err(|e| anyhow::anyhow!("embed_batch failed: {e}"))?
    };

    Ok(artifacts
        .into_iter()
        .enumerate()
        .map(|(i, artifact)| {
            let start = i * dims;
            let end = start + dims;
            let dense_vector = flat.get(start..end).unwrap_or(&[]).to_vec();
            EmbeddedChunk {
                artifact,
                dense_vector,
            }
        })
        .collect())
}

/// Find the first configured chunker whose `patterns()` match `path`.
/// Mirrors `resolveChunker`/`canProcess` matching in the deprecated TS orchestrator.
fn find_chunker<'a>(
    chunkers: &'a [Arc<dyn crate::chunkers::FileChunker>],
    path: &str,
) -> Option<&'a Arc<dyn crate::chunkers::FileChunker>> {
    chunkers.iter().find(|c| {
        c.patterns()
            .iter()
            .any(|pat| crate::sources::glob_match(pat, path))
    })
}

/// Read + parse + chunk a `WorkItem` into `ArtifactSet`s — everything up to but not including
/// embedding (ADR-057 split `process_item` in two so embedding could move to the streaming,
/// micro-batched `stream_embed_and_send` above; this half is unchanged from the pre-ADR-057
/// `process_item` other than no longer embedding at the end).
async fn parse_and_chunk(
    item: &WorkItem,
    groups: &[GroupRuntime],
    config: &PipelineConfig,
) -> anyhow::Result<Vec<ArtifactSet>> {
    let group = &groups[item.group_idx];
    let source = &group.source;
    let chunkers = &group.chunkers;

    // Read content through the group's SourceProvider (git, local fs, S3, …) — never straight
    // off local disk. This is the single content-acquisition point for both branches below, so a
    // matched format-specific chunker gets the same non-local-source support as the raw-text
    // fallback already had.
    let content: Bytes = source.read_content(&item.path, None).await?;

    // Parse into a ViDoc tree: a matching format-specific chunker if one is configured
    // and its patterns() match this path, otherwise a flat raw-text fallback.
    let matched = find_chunker(chunkers, &item.path);

    let (root, source_format, file_hash, file_size_bytes);
    if let Some(chunker) = matched {
        let parsed = match chunker.parse(&item.path, &content) {
            Ok(p) => p,
            Err(e) => {
                // A format-specific parser matched but failed (e.g. corrupt file) —
                // skip rather than silently falling back to raw-bytes decoding, which
                // would mangle binary formats (PDF/DOCX) as lossy UTF-8 text.
                tracing::warn!(
                    chunker = chunker.name(),
                    path = ?item.path,
                    error = %e,
                    "chunker failed on file"
                );
                return Ok(Vec::new());
            }
        };
        root = parsed.tree;
        source_format = chunker.name().to_string();
        file_hash = Some(format!("{:x}", Sha256::digest(&content)));
        file_size_bytes = Some(content.len() as u64);
    } else {
        root = raw_bytes_to_doc(&content, &item.path);
        source_format = extension_of(&item.path).to_string();
        file_hash = None;
        file_size_bytes = None;
    }

    // Walk the tree into chunks.
    let opts = WalkOptions {
        source_file: &item.path,
        source_format: &source_format,
        commit_hash: &item.revision,
        strategy: &config.strategy,
        sparse_text_generator_id: &config.sparse_text_generator_id,
        metadata_generator_id: &config.metadata_generator_id,
        max_tokens: config.max_tokens,
        min_tokens: config.min_tokens,
        overlap: config.overlap,
        recursive: config.recursive,
        adaptive_size: config.adaptive_size,
        file_hash: file_hash.as_deref(),
        file_size_bytes,
        file_modified_at: None,
        tags: &item.tags,
    };
    Ok(walk_to_chunks(&root, &opts))
}

/// Build a minimal ViDoc `Document` node from raw bytes.
/// Used as fallback when no format-specific chunker is available.
fn raw_bytes_to_doc(content: &[u8], path: &str) -> DocNode {
    let text = String::from_utf8_lossy(content).into_owned();
    let byte_len = content.len() as u64;

    // Split on double-newlines to produce multiple paragraphs.
    let paragraphs: Vec<DocNode> = text
        .split("\n\n")
        .filter(|s| !s.trim().is_empty())
        .enumerate()
        .scan(0u64, |byte_pos, (_, para_text)| {
            let para_bytes = para_text.len() as u64;
            let start = *byte_pos;
            *byte_pos += para_bytes + 2; // +2 for the \n\n separator
            Some(DocNode {
                node_type: DocNodeType::Paragraph,
                text: Some(para_text.trim().to_string()),
                children: None,
                attrs: DocNodeAttrs {
                    byte_start: start,
                    byte_end: start + para_bytes,
                    source_format: Some(extension_of(path).to_string()),
                    ..Default::default()
                },
            })
        })
        .collect();

    DocNode {
        node_type: DocNodeType::Document,
        text: None,
        children: Some(if paragraphs.is_empty() {
            vec![DocNode {
                node_type: DocNodeType::Paragraph,
                text: Some(text),
                children: None,
                attrs: DocNodeAttrs {
                    byte_start: 0,
                    byte_end: byte_len,
                    ..Default::default()
                },
            }]
        } else {
            paragraphs
        }),
        attrs: DocNodeAttrs {
            byte_start: 0,
            byte_end: byte_len,
            ..Default::default()
        },
    }
}

fn extension_of(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("md") | Some("mdx") => "md",
        Some("ts") | Some("tsx") => "ts",
        Some("js") | Some("jsx") => "js",
        Some("rs") => "rs",
        Some("py") => "py",
        Some("go") => "go",
        Some("java") => "java",
        Some("pdf") => "pdf",
        Some("docx") => "docx",
        _ => "text",
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::super::FixedWorkers;
    use super::*;

    #[test]
    fn raw_bytes_to_doc_produces_paragraphs() {
        let content = b"First paragraph.\n\nSecond paragraph.\n\nThird.";
        let doc = raw_bytes_to_doc(content, "README.md");
        let children = doc.children.as_deref().unwrap_or(&[]);
        assert_eq!(children.len(), 3, "expected 3 paragraphs");
        assert_eq!(
            children[0].text.as_deref().unwrap_or(""),
            "First paragraph."
        );
        assert_eq!(children[2].text.as_deref().unwrap_or(""), "Third.");
    }

    #[test]
    fn raw_bytes_to_doc_empty_content_returns_single_para() {
        let content = b"";
        let doc = raw_bytes_to_doc(content, "file.txt");
        let children = doc.children.as_deref().unwrap_or(&[]);
        assert_eq!(children.len(), 1);
    }

    #[test]
    fn extension_of_known_types() {
        assert_eq!(extension_of("foo.md"), "md");
        assert_eq!(extension_of("bar.rs"), "rs");
        assert_eq!(extension_of("baz.tsx"), "ts");
        assert_eq!(extension_of("unknown"), "text");
    }

    struct MockChunker {
        chunker_name: &'static str,
        chunker_patterns: Vec<&'static str>,
    }

    impl crate::chunkers::FileChunker for MockChunker {
        fn name(&self) -> &str {
            self.chunker_name
        }
        fn patterns(&self) -> &[&str] {
            &self.chunker_patterns
        }
        fn parse(&self, path: &str, bytes: &[u8]) -> Result<crate::chunkers::ParseResult, String> {
            let _ = bytes;
            Ok(crate::chunkers::ParseResult {
                tree: raw_bytes_to_doc(path.as_bytes(), path),
            })
        }
    }

    #[test]
    fn find_chunker_matches_by_pattern() {
        let chunkers: Vec<Arc<dyn crate::chunkers::FileChunker>> = vec![
            Arc::new(MockChunker {
                chunker_name: "pdf",
                chunker_patterns: vec!["*.pdf"],
            }),
            Arc::new(MockChunker {
                chunker_name: "md",
                chunker_patterns: vec!["*.md"],
            }),
        ];

        let found = find_chunker(&chunkers, "docs/readme.md");
        assert_eq!(found.map(|c| c.name()), Some("md"));

        let found_nested = find_chunker(&chunkers, "a/b/c/spec.pdf");
        assert_eq!(found_nested.map(|c| c.name()), Some("pdf"));

        let none = find_chunker(&chunkers, "notes.txt");
        assert!(none.is_none());
    }

    /// A minimal real chunker: emits a Heading node, which `raw_bytes_to_doc` never does. Proves
    /// `parse_and_chunk` routed through the matched chunker, not the raw-text fallback. It parses
    /// the `bytes` argument only — matching every real `FileChunker` impl since the
    /// `SourceProvider` fix, and unlike them never touches `path` for content (only chunkers.rs
    /// doc comment says `path` is extension/error-message only).
    struct MdOnlyChunker;
    impl crate::chunkers::FileChunker for MdOnlyChunker {
        fn name(&self) -> &str {
            "md"
        }
        fn patterns(&self) -> &[&str] {
            &["*.md"]
        }
        fn parse(&self, _path: &str, bytes: &[u8]) -> Result<crate::chunkers::ParseResult, String> {
            let text = String::from_utf8_lossy(bytes);
            let mut parts = text.splitn(2, '.');
            let title = parts.next().unwrap_or_default().trim().to_string();
            let body = parts.next().unwrap_or_default().trim().to_string();
            let tree = DocNode {
                node_type: DocNodeType::Document,
                text: None,
                children: Some(vec![
                    DocNode {
                        node_type: DocNodeType::Heading,
                        text: Some(title),
                        children: None,
                        attrs: DocNodeAttrs {
                            heading_level: Some(1),
                            byte_start: 0,
                            byte_end: 5,
                            ..Default::default()
                        },
                    },
                    DocNode {
                        node_type: DocNodeType::Paragraph,
                        text: Some(body),
                        children: None,
                        attrs: DocNodeAttrs {
                            byte_start: 6,
                            byte_end: bytes.len() as u64,
                            ..Default::default()
                        },
                    },
                ]),
                attrs: DocNodeAttrs {
                    byte_start: 0,
                    byte_end: bytes.len() as u64,
                    ..Default::default()
                },
            };
            Ok(crate::chunkers::ParseResult { tree })
        }
    }

    struct MockEmbedder;
    impl Embedder for MockEmbedder {
        fn dimensions(&self) -> usize {
            2
        }
        fn embed_batch(&mut self, texts: &[&str]) -> Result<Vec<f32>, String> {
            Ok(vec![0.1f32; texts.len() * 2])
        }
    }

    /// Regression test for the bug fixed here: a matched format-specific chunker must read its
    /// content through `SourceProvider::read_content`, not straight off local disk. `RemoteOnlySource`
    /// serves content purely in-memory — `item.path` never exists on the local filesystem at all
    /// (asserted below) — so if `parse_and_chunk` ever regresses to reading `item.path` directly
    /// (e.g. via `std::fs::read`/`read_for_chunker`), this test fails the same way indexing a
    /// matched-chunker file from S3 failed in production (found via an e2e gate against real
    /// S3/MinIO — CE never had a matched-chunker + non-local-source test until now).
    #[tokio::test]
    async fn matched_chunker_reads_content_via_source_provider() {
        struct RemoteOnlySource {
            content: &'static str,
        }
        #[async_trait::async_trait]
        impl SourceProvider for RemoteOnlySource {
            fn name(&self) -> &str {
                "remote-only"
            }
            fn provider_type(&self) -> &str {
                "s3"
            }
            async fn current_revision(&self) -> anyhow::Result<String> {
                Ok(String::new())
            }
            async fn file_revisions(
                &self,
                _paths: &[&str],
            ) -> anyhow::Result<std::collections::HashMap<String, String>> {
                Ok(Default::default())
            }
            async fn changed_since(
                &self,
                _rev: &str,
            ) -> anyhow::Result<Option<crate::sources::ChangedFiles>> {
                Ok(None)
            }
            fn list_all(
                &self,
                _filter: Option<crate::sources::SourceFilter>,
            ) -> futures::stream::BoxStream<'_, anyhow::Result<crate::sources::SourceItem>>
            {
                Box::pin(futures::stream::empty())
            }
            async fn read_content(
                &self,
                path: &str,
                _range: Option<crate::sources::ByteRange>,
            ) -> anyhow::Result<Bytes> {
                // The only place content can come from in this test — proves parse_and_chunk
                // routes through SourceProvider rather than reading `path` off local disk.
                assert!(
                    !std::path::Path::new(path).exists(),
                    "test path must not exist on local disk — a fs-bypassing regression \
                     could pass by accident if it did"
                );
                Ok(Bytes::from_static(self.content.as_bytes()))
            }
        }

        // A path that looks like an S3 key, deliberately not present anywhere on local disk.
        let item = WorkItem {
            path: "s3://bucket/docs/nonexistent-on-disk/report.md".into(),
            revision: "rev1".into(),
            tags: vec![],
            group_idx: 0,
        };
        let source: Arc<dyn SourceProvider> = Arc::new(RemoteOnlySource {
            content: "Title.\n\nBody text.",
        });
        let chunkers: Vec<Arc<dyn crate::chunkers::FileChunker>> = vec![Arc::new(MdOnlyChunker)];
        let groups = vec![GroupRuntime { source, chunkers }];
        let embedder: Arc<std::sync::Mutex<dyn Embedder + Send>> =
            Arc::new(std::sync::Mutex::new(MockEmbedder));
        let config = PipelineConfig {
            strategy: "window".into(),
            max_tokens: 512,
            ..Default::default()
        };

        let artifacts = parse_and_chunk(&item, &groups, &config).await.unwrap();
        let progress = ProgressCounters::new();
        let strategy: Arc<dyn ConcurrencyStrategy> = Arc::new(FixedWorkers::new(4));
        let (tx, mut rx) = mpsc::channel(8);
        stream_embed_and_send(&item, artifacts, &embedder, &tx, &progress, &strategy)
            .await
            .ok();
        drop(tx);

        let mut chunks = Vec::new();
        while let Some(r) = rx.recv().await {
            chunks.extend(r.chunks);
        }

        assert!(!chunks.is_empty());
        assert!(
            chunks[0].artifact.dense_text.starts_with("Title."),
            "expected breadcrumb from Heading node parsed from RemoteOnlySource content, got: {:?}",
            chunks[0].artifact.dense_text
        );
    }

    /// ADR-057: proves a file's chunks reach the coordinator's channel incrementally — as
    /// multiple `WorkResult`s, only the last one marked `is_final` — rather than all at once
    /// after the whole file is embedded, using a synthetic file with more artifacts than
    /// `EMBED_MICRO_BATCH_SIZE` so at least one intermediate micro-batch is observable.
    #[tokio::test]
    async fn stream_embed_and_send_delivers_multiple_micro_batches() {
        struct MockEmbedder;
        impl Embedder for MockEmbedder {
            fn dimensions(&self) -> usize {
                1
            }
            fn embed_batch(&mut self, texts: &[&str]) -> Result<Vec<f32>, String> {
                Ok(vec![0.5f32; texts.len()])
            }
        }

        // 40 artifacts > EMBED_MICRO_BATCH_SIZE (16) → at least 3 micro-batches.
        let artifacts: Vec<ArtifactSet> = (0..40)
            .map(|i| ArtifactSet {
                dense_text: format!("chunk {i}"),
                sparse_text: String::new(),
                dense_text_hash: format!("hash{i}"),
                sparse_text_generator_id: String::new(),
                metadata_generator_id: String::new(),
                metadata: Default::default(),
                source_file: "synthetic.md".into(),
                commit_hash: "rev1".into(),
            })
            .collect();

        let item = WorkItem {
            path: "synthetic.md".into(),
            revision: "rev1".into(),
            tags: vec![],
            group_idx: 0,
        };
        let embedder: Arc<std::sync::Mutex<dyn Embedder + Send>> =
            Arc::new(std::sync::Mutex::new(MockEmbedder));
        let progress = ProgressCounters::new();
        let strategy: Arc<dyn ConcurrencyStrategy> = Arc::new(FixedWorkers::new(8));
        let (tx, mut rx) = mpsc::channel(16);

        stream_embed_and_send(&item, artifacts, &embedder, &tx, &progress, &strategy)
            .await
            .ok();
        drop(tx);

        let mut results = Vec::new();
        while let Some(r) = rx.recv().await {
            results.push(r);
        }

        // 40 artifacts / 16 per micro-batch = 3 data batches + 1 empty is_final marker.
        assert!(
            results.len() >= 4,
            "expected multiple incremental WorkResults plus a final marker, got {}",
            results.len()
        );
        let final_count = results.iter().filter(|r| r.is_final).count();
        assert_eq!(final_count, 1, "exactly one WorkResult must be final");
        assert!(
            results.last().unwrap().is_final,
            "the final WorkResult must be the last one sent"
        );
        assert!(
            results.last().unwrap().chunks.is_empty(),
            "the final marker carries no chunks of its own"
        );
        let total_chunks: usize = results.iter().map(|r| r.chunks.len()).sum();
        assert_eq!(total_chunks, 40);
        // Progress chunk-counting is the coordinator's job (on upsert-batch flush) — worker.rs
        // no longer double-counts by also incrementing it here (review fix).
    }

    /// ADR-057 review fix: a micro-batch embedding failure must not be silently reported as a
    /// successful file. No `is_final: true` marker should be sent once embedding starts failing.
    #[tokio::test]
    async fn stream_embed_and_send_does_not_mark_final_on_embed_failure() {
        struct FailingEmbedder;
        impl Embedder for FailingEmbedder {
            fn dimensions(&self) -> usize {
                1
            }
            fn embed_batch(&mut self, _texts: &[&str]) -> Result<Vec<f32>, String> {
                Err("simulated ORT failure".into())
            }
        }

        let artifacts: Vec<ArtifactSet> = (0..5)
            .map(|i| ArtifactSet {
                dense_text: format!("chunk {i}"),
                sparse_text: String::new(),
                dense_text_hash: format!("hash{i}"),
                sparse_text_generator_id: String::new(),
                metadata_generator_id: String::new(),
                metadata: Default::default(),
                source_file: "broken.md".into(),
                commit_hash: "rev1".into(),
            })
            .collect();

        let item = WorkItem {
            path: "broken.md".into(),
            revision: "rev1".into(),
            tags: vec![],
            group_idx: 0,
        };
        let embedder: Arc<std::sync::Mutex<dyn Embedder + Send>> =
            Arc::new(std::sync::Mutex::new(FailingEmbedder));
        let progress = ProgressCounters::new();
        let strategy: Arc<dyn ConcurrencyStrategy> = Arc::new(FixedWorkers::new(8));
        let (tx, mut rx) = mpsc::channel(16);

        stream_embed_and_send(&item, artifacts, &embedder, &tx, &progress, &strategy)
            .await
            .ok();
        drop(tx);

        let mut results = Vec::new();
        while let Some(r) = rx.recv().await {
            results.push(r);
        }

        assert!(
            results.iter().all(|r| !r.is_final),
            "a file whose embedding failed must never receive an is_final marker"
        );
        assert_eq!(
            progress.snapshot().2,
            1,
            "failed file still counted as attempted"
        );
    }

    /// ADR-057 review fix: a gated worker (idx >= strategy.current_workers()) must never pull
    /// from `work_rx` — the original `try_recv()`-based gate made throttling cosmetic under any
    /// real backlog, since a gated worker would keep grabbing and processing items whenever the
    /// queue wasn't momentarily empty. This test queues real work, keeps the worker permanently
    /// gated (`AlwaysGated`), and proves it produces zero results and never touches the
    /// embedder — even with a full backlog sitting in the channel the whole time — until
    /// `feeder_done` tells it no more work is coming, at which point it exits cleanly without
    /// ever having pulled an item.
    #[tokio::test(start_paused = true)]
    async fn worker_task_never_pulls_work_while_gated() {
        /// Reports 0 active workers forever — every worker index is gated, always.
        struct AlwaysGated;
        impl ConcurrencyStrategy for AlwaysGated {
            fn initial_workers(&self) -> usize {
                0
            }
            fn current_workers(&self) -> usize {
                0
            }
        }

        struct UnusedEmbedder;
        impl Embedder for UnusedEmbedder {
            fn dimensions(&self) -> usize {
                unreachable!("a gated worker must never touch the embedder")
            }
            fn embed_batch(&mut self, _texts: &[&str]) -> Result<Vec<f32>, String> {
                unreachable!("a gated worker must never touch the embedder")
            }
        }

        let groups: Arc<Vec<GroupRuntime>> = Arc::new(Vec::new());
        let embedder: Arc<std::sync::Mutex<dyn Embedder + Send>> =
            Arc::new(std::sync::Mutex::new(UnusedEmbedder));
        let progress = ProgressCounters::new();
        let strategy: Arc<dyn ConcurrencyStrategy> = Arc::new(AlwaysGated);
        let feeder_done = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let (work_tx, work_rx) = mpsc::channel::<WorkItem>(4);
        let work_rx = Arc::new(tokio::sync::Mutex::new(work_rx));
        let (result_tx, mut result_rx) = mpsc::channel::<WorkResult>(4);

        // Queue real work — a worker that ignored the gate (e.g. via a bare `try_recv()`) would
        // happily consume this instead of sitting idle.
        for i in 0..3 {
            work_tx
                .send(WorkItem {
                    path: format!("file{i}.md"),
                    revision: "rev1".into(),
                    tags: vec![],
                    group_idx: 0,
                })
                .await
                .unwrap();
        }

        let feeder_done_worker = feeder_done.clone();
        let handle = tokio::spawn(async move {
            let config = PipelineConfig::default();
            worker_task(
                0,
                groups,
                embedder,
                work_rx,
                result_tx,
                &config,
                progress,
                strategy,
                feeder_done_worker,
            )
            .await
        });

        // Cycle through several sample intervals — real work sits in the channel the whole
        // time. If the gate were cosmetic, the worker would have drained and processed it by
        // now (each item would panic on `UnusedEmbedder`, failing this test).
        for _ in 0..3 {
            tokio::time::advance(CONCURRENCY_SAMPLE_INTERVAL + std::time::Duration::from_millis(1))
                .await;
        }
        assert!(
            result_rx.try_recv().is_err(),
            "gated worker must not have processed any work yet"
        );

        // Signal no more work is coming; the worker should exit without ever having pulled from
        // work_tx — the 3 queued items are still unconsumed at this point.
        feeder_done.store(true, std::sync::atomic::Ordering::Release);
        tokio::time::advance(CONCURRENCY_SAMPLE_INTERVAL + std::time::Duration::from_millis(1))
            .await;

        let result = tokio::time::timeout(std::time::Duration::from_secs(5), handle)
            .await
            .expect("worker_task should have exited promptly after feeder_done")
            .expect("worker_task must not panic");
        assert!(result.is_ok(), "worker_task should return Ok(())");
        assert!(
            result_rx.try_recv().is_err(),
            "gated worker still must not have produced any results"
        );
    }
}
