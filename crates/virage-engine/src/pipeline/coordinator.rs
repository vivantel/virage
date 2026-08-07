use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use futures::StreamExt;
use tokio::sync::mpsc;

use super::worker::GroupRuntime;
use super::{revision_key, EmbeddedChunk, FileSetGroup, WorkItem, WorkResult};
use crate::embedders::Embedder;
use crate::stores::{VectorDocument, VectorStore};

use super::{groups_need_qualified_keys, PipelineConfig, PipelineStats};

/// Run the full CE indexing pipeline.
///
/// 1. Lists all source items per fileSet `group` (respecting each group's `include`/`ignore`
///    filter and source override — ADR-043) and performs change detection against
///    `known_revisions`.
/// 2. Distributes work to `config.workers` tokio tasks via bounded channels.
/// 3. Collects `EmbeddedChunk` results and batch-upserts to `store`.
///
/// `known_revisions` maps `revision_key → file_revision` as previously stored in the VirageDb
/// state store (bare path, or `source_name:path` when `groups` span more than one distinct
/// source — see `groups_need_qualified_keys`). Pass an empty map to (re-)process everything.
pub async fn run_pipeline(
    config: &PipelineConfig,
    mut groups: Vec<FileSetGroup>,
    embedder: Arc<std::sync::Mutex<dyn Embedder + Send>>,
    store: Arc<dyn VectorStore>,
    known_revisions: HashMap<String, String>,
) -> anyhow::Result<PipelineStats> {
    store.initialize().await?;

    let progress = config.progress.clone().unwrap_or_default();
    let qualify_keys = groups_need_qualified_keys(&groups);

    // ── Collect all source items across fileSet groups ─────────────────────────
    let mut all_items: Vec<(usize, String, crate::sources::SourceItem)> = Vec::new();
    for (group_idx, group) in groups.iter_mut().enumerate() {
        let filter = group.filter.take();
        let mut stream = group.source.list_all(filter);
        while let Some(item) = stream.next().await {
            let item = item?;
            let key = revision_key(qualify_keys, group.source.name(), &item.path);
            all_items.push((group_idx, key, item));
        }
    }
    progress.set_total(all_items.len());

    // ── Change detection, batched per source to minimize file_revisions calls ──
    let mut current_revisions: HashMap<String, String> = HashMap::new();
    {
        let mut per_group_paths: HashMap<usize, Vec<&str>> = HashMap::new();
        for (group_idx, _key, item) in &all_items {
            per_group_paths
                .entry(*group_idx)
                .or_default()
                .push(item.path.as_str());
        }
        for (group_idx, paths) in per_group_paths {
            let source_name = groups[group_idx].source.name().to_string();
            let revs = groups[group_idx].source.file_revisions(&paths).await?;
            for (path, rev) in revs {
                current_revisions.insert(revision_key(qualify_keys, &source_name, &path), rev);
            }
        }
    }

    let mut to_process: Vec<WorkItem> = Vec::new();
    let mut to_delete: Vec<String> = Vec::new();
    let mut files_skipped = 0usize;
    let mut current_keys: HashSet<String> = HashSet::new();

    for (group_idx, key, item) in &all_items {
        current_keys.insert(key.clone());
        let current_rev = current_revisions.get(key).cloned().unwrap_or_default();
        match known_revisions.get(key) {
            Some(known_rev) if known_rev == &current_rev => {
                files_skipped += 1;
            }
            _ => {
                let mut tags = item.tags.clone();
                for t in &groups[*group_idx].tags {
                    if !tags.contains(t) {
                        tags.push(t.clone());
                    }
                }
                for rule in &config.label_rules {
                    if crate::sources::glob_match(&rule.pattern, &item.path) && !rule.add.is_empty()
                    {
                        for tag in &rule.add {
                            if !tags.contains(tag) {
                                tags.push(tag.clone());
                            }
                        }
                    }
                }
                to_process.push(WorkItem {
                    path: item.path.clone(),
                    revision: current_rev,
                    tags,
                    group_idx: *group_idx,
                });
                progress.inc_queued();
            }
        }
    }

    // Files that were in the store but are no longer in any fileSet's source.
    for key in known_revisions.keys() {
        if !current_keys.contains(key) {
            to_delete.push(key.clone());
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
            tokens_processed: 0,
        });
    }

    // ── Runtime group table for workers (source + chunkers; filters already applied) ──
    let group_runtime: Arc<Vec<GroupRuntime>> = Arc::new(
        groups
            .iter()
            .map(|g| GroupRuntime {
                source: g.source.clone(),
                chunkers: g.chunkers.clone(),
            })
            .collect(),
    );

    // ── Set up channels ───────────────────────────────────────────────────────
    let cap = config.workers * 4;
    let (work_tx, work_rx) = mpsc::channel::<WorkItem>(cap);
    let (result_tx, result_rx) = mpsc::channel::<WorkResult>(cap);
    let work_rx = Arc::new(tokio::sync::Mutex::new(work_rx));

    // ── Spawn worker tasks ────────────────────────────────────────────────────
    let workers = config.workers.max(1);
    let mut handles = Vec::new();
    for _ in 0..workers {
        let groups2 = group_runtime.clone();
        let embedder2 = embedder.clone();
        let result_tx2 = result_tx.clone();
        let work_rx2 = work_rx.clone();
        let config2 = config.clone();
        let progress2 = progress.clone();

        handles.push(tokio::spawn(async move {
            super::worker::worker_task(
                groups2, embedder2, work_rx2, result_tx2, &config2, progress2,
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
    let mut tokens_processed = 0usize;
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
                tokens_processed += sum_estimated_tokens(&deduped);
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
        tokens_processed += sum_estimated_tokens(&deduped);
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
        tokens_processed,
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

/// Sums the `estimatedTokens` metadata field the chunker (`chunkers::walk`) attaches to every
/// chunk. Missing/non-numeric values contribute 0 rather than failing the run.
fn sum_estimated_tokens(docs: &[VectorDocument]) -> usize {
    docs.iter()
        .filter_map(|d| d.metadata.get("estimatedTokens"))
        .filter_map(|v| v.as_f64())
        .map(|t| t as usize)
        .sum()
}

// ─── Conversion ──────────────────────────────────────────────────────────────

fn embedded_to_vecdoc(ec: EmbeddedChunk, _path: &str) -> VectorDocument {
    let tags: Vec<String> = ec
        .artifact
        .metadata
        .get("tags")
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
