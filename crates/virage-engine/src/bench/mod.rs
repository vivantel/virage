//! Indexing-throughput benchmark (`virage bench index`, IR-038 Step 6). No JS predecessor
//! measured runtime performance — the JS "bench" command actually measured external-dataset
//! accuracy, not speed (see IR-038 Context). v1 scope is indexing throughput only; query-latency
//! benchmarking (`bench query`) is deferred past v1.
//!
//! The regression gate (`--ci`, exit 5) compares against the most recent prior run for the same
//! corpus path, looked up via the shared `crate::history` store (IR-038 Step 7) — this module's
//! own provisional `.virage/bench-history.json` (Step 6) is gone now that Step 7 landed.

pub mod report;

use serde::{Deserialize, Serialize};

use crate::history::benchmark::{BenchmarkPoint, ToBenchmarkPoints};

/// Result of a single `virage bench index` run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchResult {
    pub timestamp: String,
    pub corpus_path: String,
    pub files_processed: usize,
    pub chunks_upserted: usize,
    pub tokens_processed: usize,
    pub duration_ms: u128,
    pub docs_per_sec: f64,
    pub chunks_per_sec: f64,
    pub tokens_per_sec: f64,
}

impl BenchResult {
    pub fn new(
        corpus_path: String,
        files_processed: usize,
        chunks_upserted: usize,
        tokens_processed: usize,
        duration_ms: u128,
    ) -> Self {
        // Floor at 1ms so a near-instant run (tiny corpus) can't divide-by-zero into an
        // infinite rate — it just reports a very high (but finite) throughput.
        let secs = (duration_ms.max(1) as f64) / 1000.0;
        Self {
            timestamp: crate::history::timestamp_now_iso(),
            corpus_path,
            files_processed,
            chunks_upserted,
            tokens_processed,
            duration_ms,
            docs_per_sec: files_processed as f64 / secs,
            chunks_per_sec: chunks_upserted as f64 / secs,
            tokens_per_sec: tokens_processed as f64 / secs,
        }
    }
}

/// Outcome of comparing a run against the most recent prior run for the same corpus path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchComparison {
    pub result: BenchResult,
    pub previous: Option<BenchResult>,
    /// Fractional drop in docs/sec vs. `previous` (positive = slower, negative = faster).
    /// `None` when there is no prior run for this corpus path to compare against.
    pub regression_pct: Option<f64>,
    pub gate_threshold: f64,
    pub gate_passed: bool,
}

/// Compares `result` against `previous` (the last recorded run for the same corpus path, if
/// any) and applies the `--ci` regression gate: fail when docs/sec dropped by more than
/// `gate_threshold` (fractional, e.g. `0.20` = 20%). Absence of a prior run always passes —
/// there is nothing to regress against yet, matching `eval run`'s "first run always passes its
/// own novelty" precedent.
pub fn compare(
    result: BenchResult,
    previous: Option<BenchResult>,
    gate_threshold: f64,
) -> BenchComparison {
    let regression_pct = previous.as_ref().and_then(|p| {
        if p.docs_per_sec <= 0.0 {
            None
        } else {
            Some((p.docs_per_sec - result.docs_per_sec) / p.docs_per_sec)
        }
    });
    let gate_passed = regression_pct.map(|r| r <= gate_threshold).unwrap_or(true);
    BenchComparison {
        result,
        previous,
        regression_pct,
        gate_threshold,
        gate_passed,
    }
}

impl ToBenchmarkPoints for BenchResult {
    fn to_benchmark_points(&self) -> Vec<BenchmarkPoint> {
        // Corpus path is folded into the point name — a flat "Bench docs/sec" name would
        // collide across corpora sharing one benchmark-data.json feed.
        let suffix = format!("({})", self.corpus_path);
        vec![
            BenchmarkPoint::new(
                format!("Bench docs/sec {suffix}"),
                "docs/sec",
                self.docs_per_sec,
            ),
            BenchmarkPoint::new(
                format!("Bench chunks/sec {suffix}"),
                "chunks/sec",
                self.chunks_per_sec,
            ),
            BenchmarkPoint::new(
                format!("Bench tokens/sec {suffix}"),
                "tokens/sec",
                self.tokens_per_sec,
            ),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(docs_per_sec: f64) -> BenchResult {
        BenchResult {
            timestamp: "2026-07-30T00:00:00Z".into(),
            corpus_path: "/corpus".into(),
            files_processed: 100,
            chunks_upserted: 400,
            tokens_processed: 40_000,
            duration_ms: 1000,
            docs_per_sec,
            chunks_per_sec: 400.0,
            tokens_per_sec: 40_000.0,
        }
    }

    #[test]
    fn no_previous_run_always_passes() {
        let cmp = compare(result(100.0), None, 0.20);
        assert!(cmp.gate_passed);
        assert_eq!(cmp.regression_pct, None);
    }

    #[test]
    fn regression_within_threshold_passes() {
        // 10% slower than previous, threshold 20% — passes.
        let cmp = compare(result(90.0), Some(result(100.0)), 0.20);
        assert!(cmp.gate_passed);
        assert!((cmp.regression_pct.unwrap() - 0.10).abs() < 1e-9);
    }

    #[test]
    fn regression_beyond_threshold_fails() {
        // 30% slower than previous, threshold 20% — fails.
        let cmp = compare(result(70.0), Some(result(100.0)), 0.20);
        assert!(!cmp.gate_passed);
        assert!((cmp.regression_pct.unwrap() - 0.30).abs() < 1e-9);
    }

    #[test]
    fn speedup_always_passes() {
        let cmp = compare(result(150.0), Some(result(100.0)), 0.20);
        assert!(cmp.gate_passed);
        assert!(cmp.regression_pct.unwrap() < 0.0);
    }

    #[test]
    fn zero_duration_does_not_divide_by_zero() {
        let r = BenchResult::new("/corpus".into(), 10, 40, 4000, 0);
        assert!(r.docs_per_sec.is_finite());
        assert!(r.docs_per_sec > 0.0);
    }
}
