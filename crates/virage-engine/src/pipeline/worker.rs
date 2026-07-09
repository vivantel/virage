use std::sync::Arc;

use bytes::Bytes;
use tokio::sync::mpsc;
use virage_vidoc::{DocNode, DocNodeAttrs, DocNodeType};

use crate::chunkers::walk::{walk_to_chunks, WalkOptions};
use crate::embedders::Embedder;
use crate::sources::SourceProvider;
use crate::transport::{EmbeddedChunk, WorkItem, WorkResult};

use super::{PipelineConfig, ProgressCounters};

/// Worker task: pulls `WorkItem`s, reads + chunks + embeds content, pushes `WorkResult`s.
pub async fn worker_task(
    source: Arc<dyn SourceProvider>,
    _chunkers: Vec<Arc<dyn crate::chunkers::FileChunker>>,
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

        match process_item(&item, &source, &embedder, config).await {
            Ok(chunks) => {
                let n = chunks.len();
                let result = WorkResult {
                    msg_id: item.msg_id.clone(),
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

async fn process_item(
    item: &WorkItem,
    source: &Arc<dyn SourceProvider>,
    embedder: &Arc<std::sync::Mutex<dyn Embedder + Send>>,
    config: &PipelineConfig,
) -> anyhow::Result<Vec<EmbeddedChunk>> {
    // Read raw bytes from the source provider.
    let content: Bytes = source.read_content(&item.path, None).await?;

    // Parse bytes into a ViDoc tree.
    // Phase 4: uses a flat raw-text DocNode (format-specific parsers in Phase 5).
    let root = raw_bytes_to_doc(&content, &item.path);

    // Determine source format from file extension.
    let source_format = extension_of(&item.path);

    // Walk the tree into chunks.
    let opts = WalkOptions {
        source_file: &item.path,
        source_format,
        commit_hash: &item.revision,
        strategy: &config.strategy,
        sparse_text_generator_id: &config.sparse_text_generator_id,
        metadata_generator_id: &config.metadata_generator_id,
        max_tokens: config.max_tokens,
        min_tokens: config.min_tokens,
        overlap: config.overlap,
        recursive: config.recursive,
        adaptive_size: config.adaptive_size,
        ..Default::default()
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
}
