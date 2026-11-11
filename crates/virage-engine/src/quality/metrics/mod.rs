pub mod chunking;
pub mod dense_embedding;
pub mod dense_input;
pub mod lexical_retrieval;
pub mod metadata;
pub mod reranker;
pub mod reranker_input;
pub mod sparse_input;

pub(crate) fn cosine_sim(a: &[f32], b: &[f32]) -> f64 {
    let mut dot = 0.0_f64;
    let mut norm_a = 0.0_f64;
    let mut norm_b = 0.0_f64;
    for i in 0..a.len() {
        let x = a[i] as f64;
        let y = b[i] as f64;
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

pub(crate) fn l2(a: &[f32], b: &[f32]) -> f64 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| ((*x as f64) - (*y as f64)).powi(2))
        .sum::<f64>()
        .sqrt()
}

pub(crate) fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

pub(crate) fn median(sorted: &[f64]) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let mid = sorted.len() / 2;
    if !sorted.len().is_multiple_of(2) {
        sorted[mid]
    } else {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    }
}

/// Deterministic LCG PRNG — avoids pulling in the `rand` crate for the one place
/// (PCA power iteration) that needs a random starting vector. Same generator
/// already used by `virage store perf`'s pseudo-random query vectors.
pub(crate) struct Lcg(pub u64);

impl Lcg {
    pub fn next_unit(&mut self) -> f64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) as f64 / u32::MAX as f64 - 0.5
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_sim_identical_vectors_is_one() {
        let v = [1.0_f32, 2.0, 3.0];
        assert!((cosine_sim(&v, &v) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_sim_orthogonal_vectors_is_zero() {
        assert!((cosine_sim(&[1.0, 0.0], &[0.0, 1.0]) - 0.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_sim_zero_vector_is_zero_not_nan() {
        assert_eq!(cosine_sim(&[0.0, 0.0], &[1.0, 1.0]), 0.0);
    }

    #[test]
    fn l2_distance_matches_pythagorean() {
        assert!((l2(&[0.0, 0.0], &[3.0, 4.0]) - 5.0).abs() < 1e-6);
    }

    #[test]
    fn mean_of_empty_is_zero() {
        assert_eq!(mean(&[]), 0.0);
    }

    #[test]
    fn mean_basic() {
        assert_eq!(mean(&[1.0, 2.0, 3.0]), 2.0);
    }

    #[test]
    fn median_odd_and_even_length() {
        assert_eq!(median(&[1.0, 2.0, 3.0]), 2.0);
        assert_eq!(median(&[1.0, 2.0, 3.0, 4.0]), 2.5);
    }

    #[test]
    fn lcg_produces_values_in_expected_range() {
        let mut rng = Lcg(42);
        for _ in 0..100 {
            let v = rng.next_unit();
            assert!((-0.5..=0.5).contains(&v));
        }
    }
}
