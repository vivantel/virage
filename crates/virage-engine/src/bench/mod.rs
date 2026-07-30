//! Indexing-throughput benchmark (`virage bench index`, IR-038 Step 6). No JS predecessor
//! measured runtime performance — the JS "bench" command actually measured external-dataset
//! accuracy, not speed (see IR-038 Context). v1 scope is indexing throughput only; query-latency
//! benchmarking (`bench query`) is deferred past v1.
//!
//! The regression gate (`--ci`, exit 5) compares against the most recent prior run for the same
//! corpus path in a local history file (`history::DEFAULT_HISTORY_PATH`). This is a provisional
//! stand-in for the shared history store IR-038 Step 7 introduces — same design already used for
//! `eval compare`'s baseline/candidate file args in Step 5. Step 7 swaps the storage backend;
//! the `BenchResult`/`BenchComparison` shapes below are meant to survive that swap unchanged.

pub mod history;
pub mod report;

use serde::{Deserialize, Serialize};

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
            timestamp: timestamp_now_iso(),
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

/// UTC `YYYY-MM-DDTHH:MM:SSZ` timestamp. Same hand-rolled implementation as
/// `eval::timestamp_now_iso` / `quality::runner::chrono_now_iso` — kept local rather than shared
/// to avoid making these modules depend on each other for one helper.
fn timestamp_now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let time_of_day = secs.rem_euclid(86_400);
    let (hour, minute, second) = (
        time_of_day / 3600,
        (time_of_day / 60) % 60,
        time_of_day % 60,
    );

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
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
