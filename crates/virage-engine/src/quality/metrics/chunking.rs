//! Component 1 — Chunking metrics (4 metrics).
//!
//! Cohesion:  mean cosine similarity between sentence embeddings within a chunk.
//! Integrity: fraction of AST/structural nodes fully contained within chunk boundaries.
//! Coherence: cosine similarity between adjacent chunks (non-monotonic target 0.4-0.6).
//! Coverage:  fraction of chunks whose token count falls within [min, max] range.
//!
//! Ported from `dist/quality/metrics/chunking.js` — IR-038.

use std::sync::Mutex;

use crate::embedders::Embedder;
use crate::quality::scoring::{normalize_coherence, normalize_monotonic_up01};
use crate::quality::{MetricResult, QualityChunk};

use super::cosine_sim;

fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '.' | '!' | '?' | '\n') {
            let trimmed = current.trim().to_string();
            if trimmed.len() > 10 {
                sentences.push(trimmed);
            }
            current.clear();
        }
    }
    let trimmed = current.trim().to_string();
    if trimmed.len() > 10 {
        sentences.push(trimmed);
    }
    sentences
}

fn embed_texts(
    embedder: &Mutex<dyn Embedder + Send>,
    texts: &[String],
) -> anyhow::Result<Vec<Vec<f32>>> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let text_refs: Vec<&str> = texts.iter().map(String::as_str).collect();
    let mut guard = embedder
        .lock()
        .map_err(|_| anyhow::anyhow!("embedder lock poisoned"))?;
    let dims = guard.dimensions();
    let flat = guard
        .embed_batch(&text_refs)
        .map_err(|e| anyhow::anyhow!("embed error: {e}"))?;
    Ok(flat.chunks(dims).map(|c| c.to_vec()).collect())
}

fn compute_cohesion(
    chunks: &[QualityChunk],
    embedder: &Mutex<dyn Embedder + Send>,
) -> anyhow::Result<f64> {
    let mut cohesions = Vec::new();
    for chunk in chunks {
        let sentences = split_sentences(&chunk.dense_text);
        if sentences.len() < 2 {
            continue;
        }
        let embeds = embed_texts(embedder, &sentences)?;
        let mut pair_sum = 0.0;
        let mut pair_count = 0;
        for i in 0..embeds.len() {
            for j in (i + 1)..embeds.len() {
                pair_sum += cosine_sim(&embeds[i], &embeds[j]);
                pair_count += 1;
            }
        }
        if pair_count > 0 {
            cohesions.push(pair_sum / pair_count as f64);
        }
    }
    if cohesions.is_empty() {
        Ok(0.0)
    } else {
        Ok(cohesions.iter().sum::<f64>() / cohesions.len() as f64)
    }
}

fn compute_integrity(chunks: &[QualityChunk]) -> Option<f64> {
    let mut total_nodes = 0.0;
    let mut bounded_nodes = 0.0;
    for chunk in chunks {
        let total = crate::quality::meta_f64(&chunk.metadata, "astNodeCount");
        let bounded = crate::quality::meta_f64(&chunk.metadata, "astNodeCountInBounds");
        if let (Some(total), Some(bounded)) = (total, bounded) {
            total_nodes += total;
            bounded_nodes += bounded;
        }
    }
    if total_nodes == 0.0 {
        None
    } else {
        Some(bounded_nodes / total_nodes)
    }
}

fn compute_coherence(
    chunks: &[QualityChunk],
    embedder: &Mutex<dyn Embedder + Send>,
) -> anyhow::Result<f64> {
    if chunks.len() < 2 {
        return Ok(0.5);
    }
    let texts: Vec<String> = chunks.iter().map(|c| c.dense_text.clone()).collect();
    let embeds = embed_texts(embedder, &texts)?;
    let mut sims = Vec::new();
    for i in 0..embeds.len().saturating_sub(1) {
        sims.push(cosine_sim(&embeds[i], &embeds[i + 1]));
    }
    if sims.is_empty() {
        Ok(0.0)
    } else {
        Ok(sims.iter().sum::<f64>() / sims.len() as f64)
    }
}

fn estimate_tokens(text: &str) -> f64 {
    text.split_whitespace().count() as f64
}

fn compute_coverage(chunks: &[QualityChunk], min_tokens: f64, max_tokens: f64) -> f64 {
    if chunks.is_empty() {
        return 0.0;
    }
    let in_range = chunks
        .iter()
        .filter(|c| {
            let token_count = crate::quality::meta_f64(&c.metadata, "estimatedTokens")
                .unwrap_or_else(|| estimate_tokens(&c.dense_text));
            token_count >= min_tokens && token_count <= max_tokens
        })
        .count();
    in_range as f64 / chunks.len() as f64
}

pub fn compute_chunking_metrics(
    chunks: &[QualityChunk],
    embedder: &Mutex<dyn Embedder + Send>,
    sample_size: usize,
    token_range_min: f64,
    token_range_max: f64,
) -> anyhow::Result<Vec<MetricResult>> {
    let sample: Vec<QualityChunk> = chunks.iter().take(sample_size).cloned().collect();
    let cohesion_raw = compute_cohesion(&sample, embedder)?;
    let coherence_raw = compute_coherence(&sample, embedder)?;
    let integrity_raw = compute_integrity(chunks);
    let coverage_raw = compute_coverage(chunks, token_range_min, token_range_max);

    let results = vec![
        MetricResult::new(
            "Cohesion",
            cohesion_raw,
            normalize_monotonic_up01((cohesion_raw + 1.0) / 2.0),
            2.0,
        ),
        match integrity_raw {
            Some(v) => MetricResult::new("Integrity", v, normalize_monotonic_up01(v), 2.0),
            None => MetricResult::skipped(
                "Integrity",
                2.0,
                "AST node boundary metadata not present in chunks",
            ),
        },
        MetricResult::new(
            "Coherence",
            coherence_raw,
            normalize_coherence(coherence_raw),
            0.5,
        ),
        MetricResult::new(
            "Coverage",
            coverage_raw,
            normalize_monotonic_up01(coverage_raw),
            1.0,
        ),
    ];
    Ok(results)
}
