//! Bootstrap paired significance test comparing two eval runs' per-query reciprocal-rank
//! scores. Ported 1:1 from `dist/eval/statistics.js` (IR-038 Step 5). The JS version's only
//! external dependency is `Math.random()`; this uses a seeded splitmix64 PRNG instead of
//! pulling in the `rand` crate (not currently a workspace dependency), which also makes eval
//! runs reproducible given the same seed.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Recommendation {
    Accept,
    Reject,
    Inconclusive,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapResult {
    pub baseline_mrr: f64,
    pub candidate_mrr: f64,
    pub mrr_delta: f64,
    pub p_value: f64,
    pub confidence_interval_95: (f64, f64),
    pub recommendation: Recommendation,
}

/// Default iteration count, matching the JS predecessor's default.
pub const DEFAULT_ITERATIONS: usize = 10_000;

/// Fixed default seed so `eval compare` runs are reproducible unless the caller overrides it.
pub const DEFAULT_SEED: u64 = 0x5EED_C0FF_EE00_1234;

struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform index in `0..n`.
    fn gen_index(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
}

/// Bootstrap paired test comparing per-query reciprocal-rank scores.
///
/// Algorithm (matches `dist/eval/statistics.js`):
/// 1. Compute observed delta = mean(candidate) - mean(baseline).
/// 2. Resample paired differences with replacement `iterations` times.
/// 3. p-value = fraction of bootstrap deltas <= 0 (one-tailed, candidate better).
/// 4. 95% CI = [2.5th, 97.5th] percentile of the bootstrap distribution of deltas.
pub fn bootstrap_paired_test(
    baseline_per_query: &[f64],
    candidate_per_query: &[f64],
    iterations: usize,
    seed: u64,
) -> anyhow::Result<BootstrapResult> {
    if baseline_per_query.len() != candidate_per_query.len() {
        anyhow::bail!(
            "Baseline and candidate must have the same number of queries (got {} vs {})",
            baseline_per_query.len(),
            candidate_per_query.len()
        );
    }
    let n = baseline_per_query.len();
    if n == 0 {
        anyhow::bail!("Cannot run statistical test on empty query sets");
    }

    let mean = |arr: &[f64]| arr.iter().sum::<f64>() / arr.len() as f64;
    let baseline_mrr = mean(baseline_per_query);
    let candidate_mrr = mean(candidate_per_query);
    let observed_delta = candidate_mrr - baseline_mrr;

    let differences: Vec<f64> = baseline_per_query
        .iter()
        .zip(candidate_per_query)
        .map(|(b, c)| c - b)
        .collect();

    let mut rng = SplitMix64::new(seed);
    let mut bootstrap_deltas = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let mut sum = 0.0;
        for _ in 0..n {
            sum += differences[rng.gen_index(n)];
        }
        bootstrap_deltas.push(sum / n as f64);
    }
    bootstrap_deltas.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let p_value = bootstrap_deltas.iter().filter(|&&d| d <= 0.0).count() as f64 / iterations as f64;
    let lo_idx = ((0.025 * iterations as f64).floor() as isize - 1).max(0) as usize;
    let hi_idx = ((0.975 * iterations as f64).ceil() as usize).min(iterations - 1);
    let lo = bootstrap_deltas[lo_idx];
    let hi = bootstrap_deltas[hi_idx];

    let recommendation = if lo > 0.0 {
        Recommendation::Accept
    } else if hi < 0.0 {
        Recommendation::Reject
    } else {
        Recommendation::Inconclusive
    };

    Ok(BootstrapResult {
        baseline_mrr,
        candidate_mrr,
        mrr_delta: observed_delta,
        p_value,
        confidence_interval_95: (lo, hi),
        recommendation,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_clearly_better_recommends_accept() {
        let baseline = vec![0.1; 50];
        let candidate = vec![0.9; 50];
        let result = bootstrap_paired_test(&baseline, &candidate, 2_000, DEFAULT_SEED).unwrap();
        assert_eq!(result.recommendation, Recommendation::Accept);
        assert!(result.p_value < 0.05);
    }

    #[test]
    fn candidate_clearly_worse_recommends_reject() {
        let baseline = vec![0.9; 50];
        let candidate = vec![0.1; 50];
        let result = bootstrap_paired_test(&baseline, &candidate, 2_000, DEFAULT_SEED).unwrap();
        assert_eq!(result.recommendation, Recommendation::Reject);
    }

    #[test]
    fn identical_scores_are_inconclusive() {
        let scores = vec![0.5; 30];
        let result = bootstrap_paired_test(&scores, &scores, 2_000, DEFAULT_SEED).unwrap();
        assert_eq!(result.recommendation, Recommendation::Inconclusive);
        assert_eq!(result.mrr_delta, 0.0);
    }

    #[test]
    fn mismatched_lengths_error() {
        let baseline = vec![0.5; 10];
        let candidate = vec![0.5; 5];
        assert!(bootstrap_paired_test(&baseline, &candidate, 100, DEFAULT_SEED).is_err());
    }

    #[test]
    fn empty_input_errors() {
        assert!(bootstrap_paired_test(&[], &[], 100, DEFAULT_SEED).is_err());
    }

    #[test]
    fn same_seed_is_reproducible() {
        let baseline = vec![0.2, 0.4, 0.6, 0.3, 0.5];
        let candidate = vec![0.3, 0.5, 0.5, 0.4, 0.6];
        let a = bootstrap_paired_test(&baseline, &candidate, 1_000, 42).unwrap();
        let b = bootstrap_paired_test(&baseline, &candidate, 1_000, 42).unwrap();
        assert_eq!(a.p_value, b.p_value);
        assert_eq!(a.confidence_interval_95, b.confidence_interval_95);
    }
}
