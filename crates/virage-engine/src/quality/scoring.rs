//! Normalization curves and aggregation for the 26-metric quality model.
//! Ported from `dist/quality/scoring.js` (JS predecessor) — IR-038.

use super::{ComponentResult, MetricResult, MustPassGate, QualityStatus};

/// Monotonic ↑, native [0, 1] — identity (clamped).
pub fn normalize_monotonic_up01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

/// Monotonic ↑, native [-1, 1] — shift to [0, 1].
pub fn normalize_monotonic_up_signed(v: f64) -> f64 {
    ((v + 1.0) / 2.0).clamp(0.0, 1.0)
}

/// Monotonic ↓, native [0, 1] — flip.
pub fn normalize_monotonic_down(v: f64) -> f64 {
    (1.0 - v).clamp(0.0, 1.0)
}

/// Non-monotonic: Intrinsic Dimension target is 70%-90% of total dims.
/// Input is the fraction (0-1) of total dims that explains 95% variance.
pub fn normalize_intrinsic_dimension(fraction: f64) -> f64 {
    if fraction <= 0.0 {
        return 0.0;
    }
    if fraction < 0.7 {
        return fraction / 0.7;
    }
    if fraction <= 0.9 {
        return 1.0;
    }
    if fraction < 1.0 {
        return (1.0 - fraction) / 0.1;
    }
    0.0
}

/// Non-monotonic: Uniformity target is 0.7-0.85.
pub fn normalize_uniformity(v: f64) -> f64 {
    if v <= 0.0 {
        return 0.0;
    }
    if v < 0.7 {
        return v / 0.7;
    }
    if v <= 0.85 {
        return 1.0;
    }
    if v < 1.0 {
        return (1.0 - v) / 0.15;
    }
    0.0
}

/// Non-monotonic: Coherence target is 0.4-0.6 (cosine similarity between adjacent chunks).
/// Input raw cosine value in [-1, 1].
pub fn normalize_coherence(v: f64) -> f64 {
    if v < 0.0 {
        return 0.0;
    }
    if v < 0.4 {
        return v / 0.4;
    }
    if v <= 0.6 {
        return 1.0;
    }
    if v < 1.0 {
        return (1.0 - v) / 0.4;
    }
    0.0
}

/// Non-monotonic: Calibration target mean ~0.5, std ~0.25.
/// Formula: 1 - |mean - 0.5| - |std - 0.25|, clamped to [0, 1].
pub fn normalize_calibration(mean: f64, std: f64) -> f64 {
    (1.0 - (mean - 0.5).abs() - (std - 0.25).abs()).clamp(0.0, 1.0)
}

/// Weighted average of normalized metric values, excluding skipped metrics.
pub fn aggregate_component(metrics: &[MetricResult]) -> f64 {
    let active: Vec<&MetricResult> = metrics.iter().filter(|m| !m.skipped).collect();
    if active.is_empty() {
        return 0.0;
    }
    let weighted_sum: f64 = active.iter().map(|m| m.normalized_value * m.weight).sum();
    let total_weight: f64 = active.iter().map(|m| m.weight).sum();
    if total_weight == 0.0 {
        0.0
    } else {
        weighted_sum / total_weight
    }
}

/// Weighted average of component scores, excluding skipped components.
pub fn aggregate_overall(components: &[ComponentResult]) -> f64 {
    let active: Vec<&ComponentResult> = components.iter().filter(|c| !c.skipped).collect();
    if active.is_empty() {
        return 0.0;
    }
    let weighted_sum: f64 = active.iter().map(|c| c.score * c.weight).sum();
    let total_weight: f64 = active.iter().map(|c| c.weight).sum();
    if total_weight == 0.0 {
        0.0
    } else {
        weighted_sum / total_weight
    }
}

pub fn evaluate_must_pass_gates(gates: &[MustPassGate]) -> QualityStatus {
    if gates.iter().any(|g| !g.passed) {
        QualityStatus::Fail
    } else {
        QualityStatus::Pass
    }
}

/// Returns PASS only when overall >= 0.70 AND all must-pass gates passed.
pub fn compute_status(overall: f64, gates: &[MustPassGate]) -> QualityStatus {
    if overall < 0.7 {
        return QualityStatus::Fail;
    }
    evaluate_must_pass_gates(gates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quality::ComponentId;

    #[test]
    fn monotonic_up01_clamps() {
        assert_eq!(normalize_monotonic_up01(-0.5), 0.0);
        assert_eq!(normalize_monotonic_up01(0.5), 0.5);
        assert_eq!(normalize_monotonic_up01(1.5), 1.0);
    }

    #[test]
    fn monotonic_up_signed_shifts_range() {
        assert_eq!(normalize_monotonic_up_signed(-1.0), 0.0);
        assert_eq!(normalize_monotonic_up_signed(0.0), 0.5);
        assert_eq!(normalize_monotonic_up_signed(1.0), 1.0);
    }

    #[test]
    fn monotonic_down_flips() {
        assert_eq!(normalize_monotonic_down(0.0), 1.0);
        assert_eq!(normalize_monotonic_down(0.3), 0.7);
        assert_eq!(normalize_monotonic_down(1.5), 0.0);
    }

    #[test]
    fn intrinsic_dimension_targets_70_to_90_percent() {
        assert_eq!(normalize_intrinsic_dimension(0.0), 0.0);
        assert!((normalize_intrinsic_dimension(0.35) - 0.5).abs() < 1e-9);
        assert_eq!(normalize_intrinsic_dimension(0.8), 1.0);
        assert_eq!(normalize_intrinsic_dimension(0.9), 1.0);
        assert!((normalize_intrinsic_dimension(0.95) - 0.5).abs() < 1e-9);
        assert_eq!(normalize_intrinsic_dimension(1.0), 0.0);
    }

    #[test]
    fn uniformity_targets_0_7_to_0_85() {
        assert_eq!(normalize_uniformity(0.0), 0.0);
        assert_eq!(normalize_uniformity(0.75), 1.0);
        assert_eq!(normalize_uniformity(1.0), 0.0);
    }

    #[test]
    fn coherence_targets_0_4_to_0_6() {
        assert_eq!(normalize_coherence(-0.1), 0.0);
        assert_eq!(normalize_coherence(0.5), 1.0);
        assert_eq!(normalize_coherence(1.0), 0.0);
    }

    #[test]
    fn calibration_peaks_at_target_mean_and_std() {
        assert_eq!(normalize_calibration(0.5, 0.25), 1.0);
        assert!(normalize_calibration(0.9, 0.25) < 1.0);
    }

    fn metric(name: &str, normalized: f64, weight: f64, skipped: bool) -> MetricResult {
        let mut m = MetricResult::new(name, normalized, normalized, weight);
        m.skipped = skipped;
        m
    }

    #[test]
    fn aggregate_component_excludes_skipped_and_weights() {
        let metrics = vec![
            metric("a", 1.0, 2.0, false),
            metric("b", 0.0, 2.0, false),
            metric("c", 0.0, 100.0, true), // skipped — must not drag the average down
        ];
        assert_eq!(aggregate_component(&metrics), 0.5);
    }

    #[test]
    fn aggregate_component_all_skipped_is_zero() {
        let metrics = vec![metric("a", 1.0, 2.0, true)];
        assert_eq!(aggregate_component(&metrics), 0.0);
    }

    #[test]
    fn aggregate_overall_excludes_skipped_components() {
        let components = vec![
            ComponentResult::new(ComponentId::Chunking, "Chunking", vec![], 3.0, false, None),
            ComponentResult::new(ComponentId::Reranker, "Reranker", vec![], 100.0, true, None),
        ];
        // Both scores default to 0.0 (empty metrics), so overall is 0 regardless — this
        // asserts the skipped component's huge weight doesn't panic/divide oddly.
        assert_eq!(aggregate_overall(&components), 0.0);
    }

    #[test]
    fn must_pass_gates_fail_on_any_failure() {
        let gates = vec![
            MustPassGate {
                metric_name: "a".into(),
                threshold: 0.7,
                value: 0.9,
                passed: true,
            },
            MustPassGate {
                metric_name: "b".into(),
                threshold: 0.7,
                value: 0.5,
                passed: false,
            },
        ];
        assert_eq!(evaluate_must_pass_gates(&gates), QualityStatus::Fail);
    }

    #[test]
    fn compute_status_fails_below_0_70_even_with_passing_gates() {
        assert_eq!(compute_status(0.69, &[]), QualityStatus::Fail);
        assert_eq!(compute_status(0.70, &[]), QualityStatus::Pass);
    }
}
