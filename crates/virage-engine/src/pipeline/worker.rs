use std::sync::Arc;

use bytes::Bytes;
use tokio::sync::mpsc;
use virage_vidoc::{DocNode, DocNodeAttrs, DocNodeType};

use super::{EmbeddedChunk, WorkItem, WorkResult};
use crate::chunkers::walk::{walk_to_chunks, WalkOptions};
use crate::embedders::Embedder;
use crate::sources::SourceProvider;

use super::{PipelineConfig, ProgressCounters};

/// Worker task: pulls `WorkItem`s, reads + chunks + embeds content, pushes `WorkResult`s.
pub async fn worker_task(
    source: Arc<dyn SourceProvider>,
    chunkers: Vec<Arc<dyn crate::chunkers::FileChunker>>,
    embedder: Arc<std::sync::Mutex<dyn Embedder + Send>>,
    work_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<WorkItem>>>,
    result_tx: mpsc::Sender<WorkResult>,
    config: &PipelineConfig,
    progress: Arc<ProgressCounters>,
) -> anyhow::Result<()> {
    loop {
        let item = {
            let mut rx = work_rx.lock().await;
            rx.recv().await
        };
        let item = match item {
            Some(i) => i,
            None => break, // channel closed — no more work
        };

        match process_item(&item, &source, &chunkers, &embedder, config).await {
            Ok(chunks) => {
                let n = chunks.len();
                let result = WorkResult {
                    path: item.path.clone(),
                    chunks,
                };
                if result_tx.send(result).await.is_err() {
                    break; // coordinator dropped result channel
                }
                progress.inc_done();
                progress.add_chunks(n);
            }
            Err(e) => {
                // Log but don't abort — skip this file.
                eprintln!("[virage-engine] worker skipped {:?}: {e}", item.path);
                progress.inc_done();
            }
        }
    }
    Ok(())
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

async fn process_item(
    item: &WorkItem,
    source: &Arc<dyn SourceProvider>,
    chunkers: &[Arc<dyn crate::chunkers::FileChunker>],
    embedder: &Arc<std::sync::Mutex<dyn Embedder + Send>>,
    config: &PipelineConfig,
) -> anyhow::Result<Vec<EmbeddedChunk>> {
    // Parse into a ViDoc tree: a matching format-specific chunker if one is configured
    // and its patterns() match this path, otherwise a flat raw-text fallback.
    let matched = find_chunker(chunkers, &item.path);

    let (root, source_format, file_hash, file_size_bytes);
    if let Some(chunker) = matched {
        let parsed = match chunker.parse(&item.path) {
            Ok(p) => p,
            Err(e) => {
                // A format-specific parser matched but failed (e.g. corrupt file) —
                // skip rather than silently falling back to raw-bytes decoding, which
                // would mangle binary formats (PDF/DOCX) as lossy UTF-8 text.
                eprintln!(
                    "[virage-engine] chunker {:?} failed on {:?}: {e}",
                    chunker.name(),
                    item.path
                );
                return Ok(Vec::new());
            }
        };
        root = parsed.tree;
        source_format = chunker.name().to_string();
        file_hash = Some(parsed.hash);
        file_size_bytes = Some(parsed.size as u64);
    } else {
        let content: Bytes = source.read_content(&item.path, None).await?;
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
    let artifacts = walk_to_chunks(&root, &opts);

    if artifacts.is_empty() {
        return Ok(Vec::new());
    }

    // Embed all dense_text strings in one batch call.
    let dims = {
        embedder
            .lock()
            .map_err(|e| anyhow::anyhow!("embedder lock poisoned: {e}"))?
            .dimensions()
    };
    let texts: Vec<String> = artifacts.iter().map(|a| a.dense_text.clone()).collect();
    let flat: Vec<f32> = {
        let mut emb = embedder
            .lock()
            .map_err(|e| anyhow::anyhow!("embedder lock poisoned: {e}"))?;
        emb.embed_batch(&texts)
            .map_err(|e| anyhow::anyhow!("embed_batch failed: {e}"))?
    };

    // Slice the flat vector into per-chunk embeddings.
    let chunks: Vec<EmbeddedChunk> = artifacts
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
        .collect();

    Ok(chunks)
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
        fn parse(&self, path: &str) -> Result<crate::chunkers::ParseResult, String> {
            Ok(crate::chunkers::ParseResult {
                tree: raw_bytes_to_doc(path.as_bytes(), path),
                hash: "mockhash".into(),
                size: path.len() as f64,
                modified_ms: 0.0,
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

    #[tokio::test]
    async fn process_item_uses_matched_chunker_over_raw_fallback() {
        struct NoopSource;
        #[async_trait::async_trait]
        impl SourceProvider for NoopSource {
            fn name(&self) -> &str {
                "noop"
            }
            fn provider_type(&self) -> &str {
                "noop"
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
                _path: &str,
                _range: Option<crate::sources::ByteRange>,
            ) -> anyhow::Result<Bytes> {
                unreachable!("matched-chunker path must not call read_content")
            }
        }

        // A minimal real chunker: emits a Heading node, which raw_bytes_to_doc never
        // does. Proves process_item routed through the matched chunker, not the fallback.
        struct MdOnlyChunker;
        impl crate::chunkers::FileChunker for MdOnlyChunker {
            fn name(&self) -> &str {
                "md"
            }
            fn patterns(&self) -> &[&str] {
                &["*.md"]
            }
            fn parse(&self, path: &str) -> Result<crate::chunkers::ParseResult, String> {
                let info = virage_vidoc::read_for_chunker(path)?;
                let tree = DocNode {
                    node_type: DocNodeType::Document,
                    text: None,
                    children: Some(vec![
                        DocNode {
                            node_type: DocNodeType::Heading,
                            text: Some("Title".into()),
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
                            text: Some("Body text.".into()),
                            children: None,
                            attrs: DocNodeAttrs {
                                byte_start: 6,
                                byte_end: 16,
                                ..Default::default()
                            },
                        },
                    ]),
                    attrs: DocNodeAttrs {
                        byte_start: 0,
                        byte_end: 16,
                        ..Default::default()
                    },
                };
                Ok(crate::chunkers::ParseResult {
                    tree,
                    hash: info.hash,
                    size: info.size,
                    modified_ms: info.modified_ms,
                })
            }
        }

        struct MockEmbedder;
        impl Embedder for MockEmbedder {
            fn dimensions(&self) -> usize {
                2
            }
            fn embed_batch(&mut self, texts: &[String]) -> Result<Vec<f32>, String> {
                Ok(vec![0.1f32; texts.len() * 2])
            }
        }

        let path = std::env::temp_dir().join(format!(
            "virage-worker-test-{}-{:?}.md",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::write(&path, "irrelevant on-disk content").unwrap();

        let item = WorkItem {
            path: path.to_string_lossy().to_string(),
            revision: "rev1".into(),
            tags: vec![],
        };
        let source: Arc<dyn SourceProvider> = Arc::new(NoopSource);
        let chunkers: Vec<Arc<dyn crate::chunkers::FileChunker>> = vec![Arc::new(MdOnlyChunker)];
        let embedder: Arc<std::sync::Mutex<dyn Embedder + Send>> =
            Arc::new(std::sync::Mutex::new(MockEmbedder));
        let config = PipelineConfig {
            strategy: "window".into(),
            max_tokens: 512,
            ..Default::default()
        };

        let result = process_item(&item, &source, &chunkers, &embedder, &config).await;
        std::fs::remove_file(&path).ok();
        let result = result.unwrap();

        assert!(!result.is_empty());
        assert!(
            result[0].artifact.dense_text.starts_with("Title."),
            "expected breadcrumb from Heading node, got: {:?}",
            result[0].artifact.dense_text
        );
    }
}
