//! Retrieval-accuracy evaluation (IR-038 Step 5). Ported from the JS predecessor
//! (`node_modules/@vivantel/virage-core/dist/eval/*`, see the EE-repo plan at
//! `docs/plans/eval-quality-bench-redesign.md`). v1 dataset source is `ragbench:<subset>`
//! against HuggingFace's `galileo-ai/ragbench` — custom-dataset generation is deferred.

pub mod metrics;
pub mod ragbench;
pub mod report;
pub mod statistics;

use serde::{Deserialize, Serialize};

use crate::history::benchmark::{BenchmarkPoint, ToBenchmarkPoints};

/// Results for one RAGBench subset.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubsetResult {
    pub subset: String,
    pub corpus_size: usize,
    pub queries_evaluated: usize,
    pub top_k: usize,
    pub mrr_at_k: f64,
    pub ndcg_at_k: f64,
    pub recall_at_k: f64,
    pub hit_rate_at_k: f64,
    /// Per-query reciprocal-rank scores. Kept (not just the aggregate) so `eval compare` can
    /// run the bootstrap paired significance test against a saved run.
    pub per_query_rr: Vec<f64>,
}

/// Full `virage eval run` report, one or more subsets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalReport {
    pub timestamp: String,
    pub dataset: String,
    pub subsets: Vec<SubsetResult>,
    pub total_queries: usize,
    pub total_corpus_docs: usize,
    pub top_k: usize,
    pub macro_mrr_at_k: f64,
    pub macro_ndcg_at_k: f64,
    pub macro_recall_at_k: f64,
    pub macro_hit_rate_at_k: f64,
    pub duration_ms: u128,
    pub gate_threshold: f64,
    pub gate_passed: bool,
}

impl EvalReport {
    /// All per-query RR scores across every subset, in subset order — used by `eval compare`.
    pub fn all_per_query_rr(&self) -> Vec<f64> {
        self.subsets
            .iter()
            .flat_map(|s| s.per_query_rr.iter().copied())
            .collect()
    }
}

impl ToBenchmarkPoints for EvalReport {
    fn to_benchmark_points(&self) -> Vec<BenchmarkPoint> {
        let k = self.top_k;
        let mut points = vec![
            BenchmarkPoint::new(format!("Eval Macro MRR@{k}"), "score", self.macro_mrr_at_k),
            BenchmarkPoint::new(
                format!("Eval Macro NDCG@{k}"),
                "score",
                self.macro_ndcg_at_k,
            ),
            BenchmarkPoint::new(
                format!("Eval Macro Recall@{k}"),
                "score",
                self.macro_recall_at_k,
            ),
            BenchmarkPoint::new(
                format!("Eval Macro HitRate@{k}"),
                "score",
                self.macro_hit_rate_at_k,
            ),
        ];
        for s in &self.subsets {
            points.push(BenchmarkPoint::new(
                format!("Eval {} MRR@{k}", s.subset),
                "score",
                s.mrr_at_k,
            ));
        }
        points
    }
}

fn avg(arr: impl Iterator<Item = f64> + Clone) -> f64 {
    let n = arr.clone().count();
    if n == 0 {
        0.0
    } else {
        arr.sum::<f64>() / n as f64
    }
}

/// Aggregate per-subset results into a full report, applying the `--ci` gate threshold.
pub fn build_report(
    dataset: String,
    subsets: Vec<SubsetResult>,
    top_k: usize,
    gate_threshold: f64,
    duration_ms: u128,
) -> EvalReport {
    let macro_mrr_at_k = avg(subsets.iter().map(|s| s.mrr_at_k));
    let macro_ndcg_at_k = avg(subsets.iter().map(|s| s.ndcg_at_k));
    let macro_recall_at_k = avg(subsets.iter().map(|s| s.recall_at_k));
    let macro_hit_rate_at_k = avg(subsets.iter().map(|s| s.hit_rate_at_k));
    let total_queries = subsets.iter().map(|s| s.queries_evaluated).sum();
    let total_corpus_docs = subsets.iter().map(|s| s.corpus_size).sum();
    let gate_passed = macro_mrr_at_k >= gate_threshold;

    EvalReport {
        timestamp: crate::history::timestamp_now_iso(),
        dataset,
        subsets,
        total_queries,
        total_corpus_docs,
        top_k,
        macro_mrr_at_k,
        macro_ndcg_at_k,
        macro_recall_at_k,
        macro_hit_rate_at_k,
        duration_ms,
        gate_threshold,
        gate_passed,
    }
}
