//! Component 8 — Reranker metrics (3 metrics) [optional].
//!
//! Skipped when no reranker is configured. v1 has no reranker-MRR baseline comparison
//! wired into the pipeline yet (the JS predecessor's own `runner.js` also always passed
//! `rerankerMrr: null`), so this always reports skipped — kept as a distinct component so
//! the component table matches the 8-component/26-metric model IR-038 committed to.
//!
//! Ported from `dist/quality/metrics/reranker.js` — IR-038.

use crate::quality::MetricResult;

pub fn compute_reranker_metrics(reranker_available: bool) -> Vec<MetricResult> {
    let skip_reason = if reranker_available {
        "Reranker MRR not available"
    } else {
        "No reranker configured"
    };
    vec![
        MetricResult::skipped("Uplift", 2.5, skip_reason),
        MetricResult::skipped("Calibration", 1.0, skip_reason),
        MetricResult::skipped("ConfidenceGap", 0.5, skip_reason),
    ]
}
