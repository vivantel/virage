//! Component 4 — Dense Embedding metrics (5 metrics).
//!
//! Self-Recall@K:      chunk-as-query retrieval hit rate (must-pass). Computed by the
//!                     runner (needs async vector-store search) and passed in as `self_recall`.
//! Intrinsic Dimension: PCA components to explain 95% variance (target 70-90% of dims).
//! Uniformity:         kd-tree kth-nearest distance evenness (target 0.7-0.85).
//! Isotropy:           min/max eigenvalue ratio of covariance matrix.
//! Outlier Fraction:   fraction with no close neighbours (must-pass).
//!
//! Ported from `dist/quality/metrics/dense-embedding.js` — IR-038.

use crate::quality::scoring::{
    normalize_intrinsic_dimension, normalize_monotonic_down, normalize_monotonic_up01,
    normalize_uniformity,
};
use crate::quality::MetricResult;

use super::{l2, mean, median, Lcg};

/// Power iteration to find the largest eigenvalue/eigenvector of a symmetric matrix.
fn power_iteration(m: &[Vec<f64>], rng: &mut Lcg, max_iter: usize) -> (f64, Vec<f64>) {
    let n = m.len();
    let mut v: Vec<f64> = (0..n).map(|_| rng.next_unit()).collect();
    let mut lambda = 0.0;
    for _ in 0..max_iter {
        let mv: Vec<f64> = m
            .iter()
            .map(|row| row.iter().zip(v.iter()).map(|(a, b)| a * b).sum::<f64>())
            .collect();
        lambda = mv.iter().map(|x| x * x).sum::<f64>().sqrt();
        if lambda < 1e-10 {
            break;
        }
        v = mv.iter().map(|x| x / lambda).collect();
    }
    (lambda, v)
}

fn covariance_matrix(matrix: &[Vec<f32>]) -> (usize, Vec<Vec<f64>>) {
    let n = matrix.len();
    let d = matrix[0].len();
    let col_means: Vec<f64> = (0..d)
        .map(|j| mean(&matrix.iter().map(|row| row[j] as f64).collect::<Vec<_>>()))
        .collect();
    let centered: Vec<Vec<f64>> = matrix
        .iter()
        .map(|row| {
            row.iter()
                .enumerate()
                .map(|(j, v)| *v as f64 - col_means[j])
                .collect()
        })
        .collect();
    let mut cov = vec![vec![0.0; d]; d];
    for row in &centered {
        for i in 0..d {
            for j in 0..d {
                cov[i][j] += (row[i] * row[j]) / n as f64;
            }
        }
    }
    (d, cov)
}

/// Lightweight PCA via repeated power iteration with deflation.
/// Returns explained variance fractions for each component.
fn pca(matrix: &[Vec<f32>], num_components: usize, rng: &mut Lcg) -> Vec<f64> {
    let n = matrix.len();
    let (d, cov) = covariance_matrix(matrix);
    let k = num_components.min(d).min(n.saturating_sub(1));
    let mut residual = cov;
    let mut eigenvalues = Vec::with_capacity(k);
    for _ in 0..k {
        let (lambda, v) = power_iteration(&residual, rng, 100);
        eigenvalues.push(lambda);
        for i in 0..d {
            for j in 0..d {
                residual[i][j] -= lambda * v[i] * v[j];
            }
        }
    }
    let total_var: f64 = eigenvalues.iter().sum();
    if total_var == 0.0 {
        eigenvalues.iter().map(|_| 0.0).collect()
    } else {
        eigenvalues.iter().map(|e| e / total_var).collect()
    }
}

fn compute_intrinsic_dimension(vectors: &[Vec<f32>], rng: &mut Lcg) -> f64 {
    if vectors.len() < 4 {
        return 0.0;
    }
    let total_dims = vectors[0].len();
    let max_components = total_dims.min(vectors.len() - 1).min(64);
    let variances = pca(vectors, max_components, rng);
    let mut cum_var = 0.0;
    let mut components95 = max_components;
    for (i, v) in variances.iter().enumerate() {
        cum_var += v;
        if cum_var >= 0.95 {
            components95 = i + 1;
            break;
        }
    }
    components95 as f64 / total_dims as f64
}

fn compute_uniformity(vectors: &[Vec<f32>], k: usize) -> f64 {
    if vectors.len() < k + 1 {
        return 0.0;
    }
    let kth_distances: Vec<f64> = vectors
        .iter()
        .map(|v| {
            let mut dists: Vec<f64> = vectors
                .iter()
                .filter(|u| !std::ptr::eq(u.as_slice(), v.as_slice()))
                .map(|u| l2(v, u))
                .collect();
            dists.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            dists.get(k - 1).copied().unwrap_or(0.0)
        })
        .collect();
    let avg = mean(&kth_distances);
    let std_dev = mean(
        &kth_distances
            .iter()
            .map(|d| (d - avg).powi(2))
            .collect::<Vec<_>>(),
    )
    .sqrt();
    if avg == 0.0 {
        0.0
    } else {
        (1.0 - std_dev / avg).clamp(0.0, 1.0)
    }
}

fn compute_isotropy(vectors: &[Vec<f32>], rng: &mut Lcg) -> f64 {
    if vectors.len() < 4 {
        return 0.0;
    }
    let n = vectors.len();
    let (d, cov) = covariance_matrix(vectors);
    let max_components = d.min(n - 1).min(32);
    let mut residual = cov;
    let mut variances = Vec::with_capacity(max_components);
    for _ in 0..max_components {
        let (lambda, v) = power_iteration(&residual, rng, 100);
        variances.push(lambda);
        for i in 0..d {
            for j in 0..d {
                residual[i][j] -= lambda * v[i] * v[j];
            }
        }
    }
    if variances.len() < 2 {
        return 0.0;
    }
    let max_eig = variances.iter().cloned().fold(f64::MIN, f64::max);
    let min_eig = variances
        .iter()
        .cloned()
        .filter(|v| *v > 1e-10)
        .fold(f64::MAX, f64::min);
    if max_eig == 0.0 {
        0.0
    } else {
        (min_eig / max_eig).min(1.0)
    }
}

fn compute_outlier_fraction(vectors: &[Vec<f32>]) -> f64 {
    if vectors.len() < 4 {
        return 0.0;
    }
    let nearest_dists: Vec<f64> = vectors
        .iter()
        .map(|v| {
            vectors
                .iter()
                .filter(|u| !std::ptr::eq(u.as_slice(), v.as_slice()))
                .map(|u| l2(v, u))
                .fold(f64::MAX, f64::min)
        })
        .collect();
    let mut sorted = nearest_dists.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let med = median(&sorted);
    let mut abs_devs: Vec<f64> = sorted.iter().map(|d| (d - med).abs()).collect();
    abs_devs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mad = median(&abs_devs);
    let threshold = med + 3.0 * mad;
    let outliers = nearest_dists.iter().filter(|d| **d > threshold).count();
    outliers as f64 / vectors.len() as f64
}

#[allow(clippy::too_many_arguments)]
pub fn compute_dense_embedding_metrics(
    self_recall: f64,
    vectors: &[Vec<f32>],
    self_recall_threshold: f64,
    outlier_threshold: f64,
) -> Vec<MetricResult> {
    let mut rng = Lcg(0xC0FFEE_u64);
    let insufficient = vectors.len() < 4;
    let id_fraction = compute_intrinsic_dimension(vectors, &mut rng);
    let uniformity = compute_uniformity(vectors, 5);
    let isotropy = compute_isotropy(vectors, &mut rng);
    let outlier_fraction = compute_outlier_fraction(vectors);

    let mut results = Vec::with_capacity(5);
    results.push(
        MetricResult::new(
            "SelfRecall@K",
            self_recall,
            normalize_monotonic_up01(self_recall),
            3.0,
        )
        .with_must_pass(self_recall_threshold, self_recall > self_recall_threshold),
    );
    if insufficient {
        results.push(MetricResult::skipped(
            "IntrinsicDimension",
            1.0,
            "Insufficient sample for PCA",
        ));
        results.push(MetricResult::skipped(
            "Uniformity",
            1.0,
            "Insufficient sample",
        ));
        results.push(MetricResult::skipped(
            "Isotropy",
            0.5,
            "Insufficient sample",
        ));
        let mut m = MetricResult::skipped("OutlierFraction", 1.0, "Insufficient sample");
        m.must_pass = true;
        m.must_pass_threshold = Some(outlier_threshold);
        results.push(m);
    } else {
        results.push(MetricResult::new(
            "IntrinsicDimension",
            id_fraction,
            normalize_intrinsic_dimension(id_fraction),
            1.0,
        ));
        results.push(MetricResult::new(
            "Uniformity",
            uniformity,
            normalize_uniformity(uniformity),
            1.0,
        ));
        results.push(MetricResult::new(
            "Isotropy",
            isotropy,
            normalize_monotonic_up01(isotropy),
            0.5,
        ));
        results.push(
            MetricResult::new(
                "OutlierFraction",
                outlier_fraction,
                normalize_monotonic_down(outlier_fraction),
                1.0,
            )
            .with_must_pass(outlier_threshold, outlier_fraction < outlier_threshold),
        );
    }
    results
}
