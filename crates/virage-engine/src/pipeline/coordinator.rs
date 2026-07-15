use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use futures::StreamExt;
use tokio::sync::mpsc;

use super::{EmbeddedChunk, WorkItem, WorkResult};
use crate::embedders::Embedder;
use crate::sources::SourceProvider;
use crate::stores::{VectorDocument, VectorStore};

use super::{PipelineConfig, PipelineStats, ProgressCounters};

/// Run the full CE indexing pipeline.
///
/// 1. Lists all source items and performs change detection against `known_revisions`.
/// 2. Distributes work to `config.workers` tokio tasks via bounded channels.
/// 3. Collects `EmbeddedChunk` results and batch-upserts to `store`.
///
/// `known_revisions` maps `source_file → file_revision` as previously stored
/// in the VirageDb state store. Pass an empty map to (re-)process everything.
pub async fn run_pipeline(
    config: &PipelineConfig,
    source: Arc<dyn SourceProvider>,
    chunkers: Vec<Arc<dyn crate::chunkers::FileChunker>>,
    embedder: Arc<std::sync::Mutex<dyn Embedder + Send>>,
    store: Arc<dyn VectorStore>,
    known_revisions: HashMap<String, String>,
) -> anyhow::Result<PipelineStats> {
    store.initialize().await?;

    let progress = config.progress.clone().unwrap_or_default();

    // ── Collect all source items ──────────────────────────────────────────────
    let mut all_items = Vec::new();
    {
        let mut stream = source.list_all(None);
        while let Some(item) = stream.next().await {
            all_items.push(item?);
        }
    }
    progress.set_total(all_items.len());

    // ── Change detection ──────────────────────────────────────────────────────
    let paths: Vec<&str> = all_items.iter().map(|i| i.path.as_str()).collect();
    let current_revisions = source.file_revisions(&paths).await?;

    let mut to_process: Vec<WorkItem> = Vec::new();
    let mut to_delete: Vec<String> = Vec::new();
    let mut files_skipped = 0usize;

    for item in &all_items {
        let current_rev = current_revisions
            .get(&item.path)
            .cloned()
            .unwrap_or_default();
        match known_revisions.get(&item.path) {
            Some(known_rev) if known_rev == &current_rev => {
                files_skipped += 1;
            }
            _ => {
                to_process.push(WorkItem {
                    path: item.path.clone(),
                    revision: current_rev,
                    labels: item.labels.clone(),
                });
                progress.inc_queued();
            }
        }
    }

    // Files that were in the store but are no longer in the source.
    let source_paths: std::collections::HashSet<&str> =
        all_items.iter().map(|i| i.path.as_str()).collect();
    for path in known_revisions.keys() {
        if !source_paths.contains(path.as_str()) {
            to_delete.push(path.clone());
        }
    }

    // ── Delete removed files from store ───────────────────────────────────────
    if !to_delete.is_empty() {
        let del_refs: Vec<&str> = to_delete.iter().map(String::as_str).collect();
        store.delete_by_source(&del_refs).await?;
    }

    let total_to_process = to_process.len();
    if total_to_process == 0 {
        return Ok(PipelineStats {
            files_processed: 0,
            files_skipped,
            files_deleted: to_delete.len(),
            chunks_upserted: 0,
        });
    }

    // ── Set up channels ───────────────────────────────────────────────────────
    let cap = config.workers * 4;
    let (work_tx, work_rx) = mpsc::channel::<WorkItem>(cap);
    let (result_tx, result_rx) = mpsc::channel::<WorkResult>(cap);
    let work_rx = Arc::new(tokio::sync::Mutex::new(work_rx));

    // ── Spawn worker tasks ────────────────────────────────────────────────────
    let workers = config.workers.max(1);
    let mut handles = Vec::new();
    for _ in 0..workers {
        let source2 = source.clone();
        let chunkers2 = chunkers.clone();
        let embedder2 = embedder.clone();
        let result_tx2 = result_tx.clone();
        let work_rx2 = work_rx.clone();
        let config2 = config.clone();
        let progress2 = progress.clone();

        handles.push(tokio::spawn(async move {
            super::worker::worker_task(
                source2, chunkers2, embedder2, work_rx2, result_tx2, &config2, progress2,
            )
            .await
        }));
    }
    drop(result_tx); // coordinator holds no result sender; workers do

    // ── Feed work ─────────────────────────────────────────────────────────────
    tokio::spawn(async move {
        for item in to_process {
            if work_tx.send(item).await.is_err() {
                break;
            }
        }
        // Dropping work_tx closes the channel → workers see None and exit.
    });

    // ── Collect results and batch-upsert ──────────────────────────────────────
    let mut files_processed = 0usize;
    let mut chunks_upserted = 0usize;
    let batch_size = config.upload_batch_size;
    let mut batch: Vec<VectorDocument> = Vec::with_capacity(batch_size);

    let mut result_rx = result_rx;
    while let Some(result) = result_rx.recv().await {
        files_processed += 1;
        progress.inc_done();
        for ec in result.chunks {
            batch.push(embedded_to_vecdoc(ec, &result.path));
            if batch.len() >= batch_size {
                let deduped = dedup_by_id(std::mem::take(&mut batch));
                if !config.skip_upload {
                    store.upsert(&deduped).await?;
                }
                chunks_upserted += deduped.len();
                progress.add_chunks(deduped.len());
            }
        }
    }
    if !batch.is_empty() {
        let deduped = dedup_by_id(batch);
        if !config.skip_upload {
            store.upsert(&deduped).await?;
        }
        chunks_upserted += deduped.len();
        progress.add_chunks(deduped.len());
    }

    // Wait for all workers to finish.
    for h in handles {
        h.await??;
    }

    Ok(PipelineStats {
        files_processed,
        files_skipped,
        files_deleted: to_delete.len(),
        chunks_upserted,
    })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Port of TS `deduplicateByHash` (uploader.ts). LanceDB's merge_insert rejects
/// batches where multiple source rows share the same id; deduplicate first-occurrence wins.
fn dedup_by_id(batch: Vec<VectorDocument>) -> Vec<VectorDocument> {
    let mut seen = HashSet::new();
    batch
        .into_iter()
        .filter(|d| seen.insert(d.id.clone()))
        .collect()
}

// ─── Conversion ──────────────────────────────────────────────────────────────

fn embedded_to_vecdoc(ec: EmbeddedChunk, _path: &str) -> VectorDocument {
    let tags: Vec<String> = ec
        .artifact
        .metadata
        .get("labels")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    VectorDocument {
        id: ec.artifact.dense_text_hash.clone(),
        dense_text: ec.artifact.dense_text,
        sparse_text: ec.artifact.sparse_text,
        dense_text_hash: ec.artifact.dense_text_hash,
        sparse_text_generator_id: ec.artifact.sparse_text_generator_id,
        metadata_generator_id: ec.artifact.metadata_generator_id,
        metadata: ec.artifact.metadata,
        tags,
        dense_vector: ec.dense_vector,
        source_file: ec.artifact.source_file,
        commit_hash: ec.artifact.commit_hash,
    }
}
