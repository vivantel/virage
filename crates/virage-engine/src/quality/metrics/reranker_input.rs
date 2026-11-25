//! Component 7 — Reranker Input Construction metrics (4 metrics) [optional].
//!
//! Skipped entirely when no reranker is configured. v1 has no reranker-input-sample
//! collection wired into the pipeline yet (the JS predecessor's own `runner.js` also
//! always passed `samples: []`), so this always reports skipped — kept as a distinct
//! component (not folded away) so `virage quality run`'s component table matches the
//! 8-component/26-metric model IR-038 committed to, ready for real samples later.
//!
//! Ported from `dist/quality/metrics/reranker-input.js` — IR-038.

use crate::quality::MetricResult;

pub fn compute_reranker_input_metrics(reranker_available: bool) -> Vec<MetricResult> {
    let skip_reason = if reranker_available {
        "No reranker input samples"
    } else {
        "No reranker configured"
    };
    vec![
        MetricResult::skipped("FeatureCompleteness", 1.0, skip_reason),
        MetricResult::skipped("FeatureAblationImpact", 1.0, skip_reason),
        MetricResult::skipped("FeatureRedundancy", 0.5, skip_reason),
        MetricResult::skipped("InputConsistency", 1.0, skip_reason),
    ]
}
