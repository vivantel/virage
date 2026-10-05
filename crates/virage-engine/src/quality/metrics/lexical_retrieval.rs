//! Component 6 — Lexical Retrieval metrics (1 metric) [optional].
//!
//! Lexical Recall@K: same as Self-Recall but using BM25/FTS instead of dense search.
//! Skipped when FTS is not available on the configured vector store, or no chunks sampled.
//! The recall value itself is computed by the runner (needs async vector-store search).
//!
//! Ported from `dist/quality/metrics/lexical-retrieval.js` — IR-038.

use crate::quality::scoring::normalize_monotonic_up01;
use crate::quality::MetricResult;

pub fn compute_lexical_retrieval_metrics(
    recall: Option<f64>,
    skip_reason: &str,
) -> Vec<MetricResult> {
    match recall {
        None => vec![MetricResult::skipped("LexicalRecall@K", 1.5, skip_reason)],
        Some(v) => vec![MetricResult::new(
            "LexicalRecall@K",
            v,
            normalize_monotonic_up01(v),
            1.5,
        )],
    }
}
