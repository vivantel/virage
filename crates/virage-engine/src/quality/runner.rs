//! QualityRunner — orchestrates all 8 pipeline component metric collections.
//!
//! Loads the vector store, samples chunks, runs each component's metrics in dependency
//! order, aggregates scores, and returns a `QualityReport`. Optional components (5-8) are
//! skipped gracefully when not configured. Ported from `dist/quality/runner.js` — IR-038.

use std::collections::HashSet;
use std::sync::Mutex;

use crate::config::VirageConfigJson;
use crate::embedders::Embedder;
use crate::stores::{SearchOptions, VectorStore};

use super::metrics::{
    chunking::compute_chunking_metrics, dense_embedding::compute_dense_embedding_metrics,
    dense_input::compute_dense_input_metrics, lexical_retrieval::compute_lexical_retrieval_metrics,
    metadata::compute_metadata_metrics, reranker::compute_reranker_metrics,
    reranker_input::compute_reranker_input_metrics, sparse_input::compute_sparse_input_metrics,
};
use super::scoring::{aggregate_overall, compute_status};
use super::{ComponentId, ComponentResult, MustPassGate, QualityChunk, QualityReport};

// Component total weights, used for overall aggregation. Sum of each component's metric
// weights, matching the JS predecessor's `COMPONENT_WEIGHTS`.
const WEIGHT_CHUNKING: f64 = 2.0 + 2.0 + 0.5 + 1.0;
const WEIGHT_METADATA: f64 = 1.0 + 1.0 + 1.0 + 1.0 + 0.5;
const WEIGHT_DENSE_INPUT: f64 = 1.0 + 1.0;
const WEIGHT_DENSE_EMBEDDING: f64 = 3.0 + 1.0 + 1.0 + 0.5 + 1.0;
const WEIGHT_SPARSE_INPUT: f64 = 1.0 + 0.5;
const WEIGHT_LEXICAL_RETRIEVAL: f64 = 1.5;
const WEIGHT_RERANKER_INPUT: f64 = 1.0 + 1.0 + 0.5 + 1.0;
const WEIGHT_RERANKER: f64 = 2.5 + 1.0 + 0.5;

pub struct QualityRunOptions {
    pub config_file: String,
    pub sample_size: usize,
    pub top_k: usize,
}

fn sample_evenly(chunks: Vec<QualityChunk>, n: usize) -> Vec<QualityChunk> {
    if chunks.len() <= n {
        return chunks;
    }
    let step = chunks.len() as f64 / n as f64;
    (0..n)
        .map(|i| chunks[(i as f64 * step) as usize].clone())
        .collect()
}

fn collect_must_pass_gates(components: &[ComponentResult]) -> Vec<MustPassGate> {
    let mut gates = Vec::new();
    for comp in components {
        for m in &comp.metrics {
            if m.must_pass && !m.skipped {
                if let Some(passed) = m.must_pass_passed {
                    gates.push(MustPassGate {
                        metric_name: m.name.clone(),
                        threshold: m.must_pass_threshold.unwrap_or(0.0),
                        value: m.raw_value,
                        passed,
                    });
                }
            }
        }
    }
    gates
}

async fn compute_recall(
    store: &dyn VectorStore,
    embedder: &Mutex<dyn Embedder + Send>,
    chunks: &[QualityChunk],
    top_k: usize,
    opts: SearchOptions,
) -> anyhow::Result<f64> {
    if chunks.is_empty() {
        return Ok(0.0);
    }
    let mut hits = 0;
    for chunk in chunks {
        let query: String = chunk.dense_text.chars().take(80).collect();
        let vec = {
            let mut guard = embedder
                .lock()
                .map_err(|_| anyhow::anyhow!("embedder lock poisoned"))?;
            guard
                .embed_batch(std::slice::from_ref(&query))
                .map_err(|e| anyhow::anyhow!("embed error: {e}"))?
        };
        let search_opts = SearchOptions {
            hybrid: opts.hybrid,
            hybrid_alpha: opts.hybrid_alpha,
            query_text: if opts.hybrid {
                Some(query.clone())
            } else {
                None
            },
            filter: None,
            tag_filter: None,
        };
        let results = store.search(&vec, top_k, search_opts).await?;
        if results.iter().any(|r| r.id == chunk.id) {
            hits += 1;
        }
    }
    Ok(hits as f64 / chunks.len() as f64)
}

pub async fn run_quality_assessment(
    cfg: &VirageConfigJson,
    dims: usize,
    opts: &QualityRunOptions,
) -> anyhow::Result<QualityReport> {
    let t0 = std::time::Instant::now();

    let thresholds = cfg.quality.as_ref();
    let import_threshold = thresholds
        .map(|q| q.import_resolution_min())
        .unwrap_or(crate::config::QualityThresholds::DEFAULT_IMPORT_RESOLUTION_MIN);
    let self_recall_threshold = thresholds
        .map(|q| q.self_recall_min())
        .unwrap_or(crate::config::QualityThresholds::DEFAULT_SELF_RECALL_MIN);
    let outlier_threshold = thresholds
        .map(|q| q.outlier_fraction_max())
        .unwrap_or(crate::config::QualityThresholds::DEFAULT_OUTLIER_FRACTION_MAX);

    let embedder = crate::config::resolve::resolve_embedder(&cfg.providers.embedder)?;
    let store = crate::config::resolve::resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;

    let Some(all_results) = store.list_all().await? else {
        anyhow::bail!(
            "Vector store does not support listing all chunks — cannot run quality assessment."
        );
    };
    if all_results.is_empty() {
        anyhow::bail!("No chunks found in vector store — run `virage index` first.");
    }
    let all_chunks: Vec<QualityChunk> = all_results
        .into_iter()
        .map(|r| QualityChunk {
            id: r.id,
            dense_text: r.dense_text,
            sparse_text: r.sparse_text,
            metadata: r.metadata,
            source_file: r.source_file,
        })
        .collect();
    let chunk_id_set: HashSet<String> = all_chunks.iter().map(|c| c.id.clone()).collect();
    let sample = sample_evenly(all_chunks, opts.sample_size);

    // Reranker availability.
    let reranker_available = cfg.providers.reranker.is_some();

    let mut components = Vec::with_capacity(8);

    // ─── Component 1: Chunking ────────────────────────────────────────────────
    let chunking_metrics = compute_chunking_metrics(
        &sample,
        embedder.as_ref(),
        opts.sample_size.min(50),
        50.0,
        512.0,
    )?;
    components.push(ComponentResult::new(
        ComponentId::Chunking,
        "Chunking",
        chunking_metrics,
        WEIGHT_CHUNKING,
        false,
        None,
    ));

    // ─── Component 2: Metadata ────────────────────────────────────────────────
    let metadata_metrics = compute_metadata_metrics(&sample, &chunk_id_set, import_threshold);
    components.push(ComponentResult::new(
        ComponentId::Metadata,
        "Metadata Extraction",
        metadata_metrics,
        WEIGHT_METADATA,
        false,
        None,
    ));

    // ─── Component 3: Dense Input ─────────────────────────────────────────────
    let dense_input_metrics =
        compute_dense_input_metrics(&sample, embedder.as_ref(), opts.sample_size.min(30))?;
    components.push(ComponentResult::new(
        ComponentId::DenseInput,
        "Dense Input Prep",
        dense_input_metrics,
        WEIGHT_DENSE_INPUT,
        false,
        None,
    ));

    // ─── Component 4: Dense Embedding ─────────────────────────────────────────
    let dense_sample: Vec<QualityChunk> = sample
        .iter()
        .take(opts.sample_size.min(200))
        .cloned()
        .collect();
    let self_recall = compute_recall(
        store.as_ref(),
        embedder.as_ref(),
        &dense_sample,
        opts.top_k,
        SearchOptions::default(),
    )
    .await?;
    let vectors: Vec<Vec<f32>> = {
        let mut guard = embedder
            .lock()
            .map_err(|_| anyhow::anyhow!("embedder lock poisoned"))?;
        let d = guard.dimensions();
        let texts: Vec<String> = dense_sample.iter().map(|c| c.dense_text.clone()).collect();
        if texts.is_empty() {
            Vec::new()
        } else {
            let flat = guard
                .embed_batch(&texts)
                .map_err(|e| anyhow::anyhow!("embed error: {e}"))?;
            flat.chunks(d).map(|c| c.to_vec()).collect()
        }
    };
    let dense_embedding_metrics = compute_dense_embedding_metrics(
        self_recall,
        &vectors,
        self_recall_threshold,
        outlier_threshold,
    );
    components.push(ComponentResult::new(
        ComponentId::DenseEmbedding,
        "Dense Embedding",
        dense_embedding_metrics,
        WEIGHT_DENSE_EMBEDDING,
        false,
        None,
    ));

    // ─── Component 5: Sparse Input (optional) ─────────────────────────────────
    let sparse_texts: Vec<String> = sample
        .iter()
        .filter(|c| !c.sparse_text.is_empty())
        .map(|c| c.sparse_text.clone())
        .collect();
    let sparse_skipped = sparse_texts.is_empty();
    let sparse_input_metrics = compute_sparse_input_metrics(&sparse_texts, None);
    components.push(ComponentResult::new(
        ComponentId::SparseInput,
        "Sparse Input Prep",
        sparse_input_metrics,
        WEIGHT_SPARSE_INPUT,
        sparse_skipped,
        sparse_skipped.then(|| "No sparseText in sampled chunks".to_string()),
    ));

    // ─── Component 6: Lexical Retrieval (optional) ────────────────────────────
    let fts_probe = store
        .search(
            &vec![0.0_f32; dims],
            1,
            SearchOptions {
                hybrid: true,
                hybrid_alpha: 0.0,
                query_text: Some("test".to_string()),
                filter: None,
                tag_filter: None,
            },
        )
        .await;
    let lexical_metrics = if fts_probe.is_err() {
        compute_lexical_retrieval_metrics(
            None,
            "FTS/BM25 search not available on this vector store",
        )
    } else if sample.is_empty() {
        compute_lexical_retrieval_metrics(None, "No chunks in sample")
    } else {
        let lexical_recall = compute_recall(
            store.as_ref(),
            embedder.as_ref(),
            &sample,
            opts.top_k,
            SearchOptions {
                hybrid: true,
                hybrid_alpha: 0.0,
                query_text: None,
                filter: None,
                tag_filter: None,
            },
        )
        .await?;
        compute_lexical_retrieval_metrics(Some(lexical_recall), "")
    };
    components.push(ComponentResult::new(
        ComponentId::LexicalRetrieval,
        "Lexical Retrieval",
        lexical_metrics,
        WEIGHT_LEXICAL_RETRIEVAL,
        false,
        None,
    ));

    // ─── Component 7: Reranker Input (optional) ───────────────────────────────
    let reranker_input_metrics = compute_reranker_input_metrics(reranker_available);
    components.push(ComponentResult::new(
        ComponentId::RerankerInput,
        "Reranker Input",
        reranker_input_metrics,
        WEIGHT_RERANKER_INPUT,
        !reranker_available,
        (!reranker_available).then(|| "No reranker configured".to_string()),
    ));

    // ─── Component 8: Reranker (optional) ─────────────────────────────────────
    let reranker_metrics = compute_reranker_metrics(reranker_available);
    components.push(ComponentResult::new(
        ComponentId::Reranker,
        "Reranker",
        reranker_metrics,
        WEIGHT_RERANKER,
        !reranker_available,
        (!reranker_available).then(|| "No reranker configured".to_string()),
    ));

    let must_pass_gates = collect_must_pass_gates(&components);
    let overall_score = aggregate_overall(&components);
    let status = compute_status(overall_score, &must_pass_gates);

    Ok(QualityReport {
        timestamp: crate::history::timestamp_now_iso(),
        overall_score,
        status,
        must_pass_gates,
        components,
        sample_size: opts.sample_size,
        top_k: opts.top_k,
        config_file: opts.config_file.clone(),
        duration_ms: t0.elapsed().as_millis(),
    })
}
