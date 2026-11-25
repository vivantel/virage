//! Component 3 — Dense Input Preparation metrics (2 metrics).
//!
//! Text Purity:        fraction of printable/non-control characters in denseText.
//! Enrichment Quality: cosine similarity between raw chunk text and enriched denseText.
//!
//! Ported from `dist/quality/metrics/dense-input.js` — IR-038.

use std::sync::Mutex;

use crate::embedders::Embedder;
use crate::quality::scoring::normalize_monotonic_up01;
use crate::quality::{MetricResult, QualityChunk};

use super::cosine_sim;

fn is_printable(ch: char) -> bool {
    let cp = ch as u32;
    cp >= 0x20 && cp != 0x7f
}

fn compute_text_purity(dense_text: &str) -> f64 {
    if dense_text.is_empty() {
        return 0.0;
    }
    let total = dense_text.chars().count();
    let printable = dense_text.chars().filter(|c| is_printable(*c)).count();
    printable as f64 / total as f64
}

pub fn compute_dense_input_metrics(
    chunks: &[QualityChunk],
    embedder: &Mutex<dyn Embedder + Send>,
    sample_size: usize,
) -> anyhow::Result<Vec<MetricResult>> {
    let sample: Vec<&QualityChunk> = chunks.iter().take(sample_size).collect();

    let purities: Vec<f64> = sample
        .iter()
        .map(|c| compute_text_purity(&c.dense_text))
        .collect();
    let purity = if purities.is_empty() {
        0.0
    } else {
        purities.iter().sum::<f64>() / purities.len() as f64
    };

    let enriched_pairs: Vec<&QualityChunk> = sample
        .iter()
        .filter(|c| !c.sparse_text.is_empty() && c.sparse_text != c.dense_text)
        .copied()
        .collect();

    let enrichment_quality = if enriched_pairs.is_empty() {
        None
    } else {
        let mut guard = embedder
            .lock()
            .map_err(|_| anyhow::anyhow!("embedder lock poisoned"))?;
        let dims = guard.dimensions();
        let mut sims = Vec::with_capacity(enriched_pairs.len());
        for chunk in &enriched_pairs {
            let texts = [chunk.sparse_text.as_str(), chunk.dense_text.as_str()];
            let flat = guard
                .embed_batch(&texts)
                .map_err(|e| anyhow::anyhow!("embed error: {e}"))?;
            let raw = &flat[0..dims];
            let enriched = &flat[dims..dims * 2];
            sims.push(cosine_sim(raw, enriched));
        }
        Some(sims.iter().sum::<f64>() / sims.len() as f64)
    };

    let results = vec![
        MetricResult::new("TextPurity", purity, normalize_monotonic_up01(purity), 1.0),
        match enrichment_quality {
            Some(v) => MetricResult::new(
                "EnrichmentQuality",
                v,
                normalize_monotonic_up01((v + 1.0) / 2.0),
                1.0,
            ),
            None => MetricResult::skipped(
                "EnrichmentQuality",
                1.0,
                "sparseText equals denseText in all sampled chunks (no enrichment detected)",
            ),
        },
    ];
    Ok(results)
}
