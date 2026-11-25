//! Pure retrieval evaluation metric functions. No I/O, no side effects. Ported from
//! `dist/eval/metrics.js` and `dist/eval/ragbench-hf.js`'s `ndcgAtK` — IR-038 Step 5.

use std::collections::HashSet;

/// Precision@K: fraction of the top-K retrieved items that are relevant.
pub fn precision_at_k(retrieved: &[String], relevant: &HashSet<String>, k: usize) -> f64 {
    if k == 0 {
        return 0.0;
    }
    let top_k = &retrieved[..retrieved.len().min(k)];
    let hits = top_k.iter().filter(|id| relevant.contains(*id)).count();
    hits as f64 / k as f64
}

/// Recall@K: fraction of relevant items found in the top-K retrieved items.
pub fn recall_at_k(retrieved: &[String], relevant: &HashSet<String>, k: usize) -> f64 {
    if relevant.is_empty() {
        return 0.0;
    }
    let top_k = &retrieved[..retrieved.len().min(k)];
    let hits = top_k.iter().filter(|id| relevant.contains(*id)).count();
    hits as f64 / relevant.len() as f64
}

/// Reciprocal Rank: 1 / rank of the first relevant result (0 if none).
pub fn reciprocal_rank(retrieved: &[String], relevant: &HashSet<String>) -> f64 {
    for (i, id) in retrieved.iter().enumerate() {
        if relevant.contains(id) {
            return 1.0 / (i + 1) as f64;
        }
    }
    0.0
}

/// HitRate@K: 1 if at least one relevant result is in the top-K, else 0.
pub fn hit_rate_at_k(retrieved: &[String], relevant: &HashSet<String>, k: usize) -> f64 {
    let top_k = &retrieved[..retrieved.len().min(k)];
    if top_k.iter().any(|id| relevant.contains(id)) {
        1.0
    } else {
        0.0
    }
}

/// NDCG@K with binary relevance (relevance = 1 for every relevant doc). Ported from
/// `ragbench-hf.js`'s `ndcgAtK` — RAGBench ground truth carries no graded relevance.
pub fn ndcg_at_k(retrieved: &[String], relevant: &HashSet<String>, k: usize) -> f64 {
    let mut dcg = 0.0;
    for (i, id) in retrieved.iter().take(k).enumerate() {
        if relevant.contains(id) {
            dcg += 1.0 / (i as f64 + 2.0).log2();
        }
    }
    let ideal_count = relevant.len().min(k);
    let mut idcg = 0.0;
    for i in 0..ideal_count {
        idcg += 1.0 / (i as f64 + 2.0).log2();
    }
    if idcg == 0.0 {
        0.0
    } else {
        dcg / idcg
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    fn vec_of(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn precision_recall_hit_rate_basic() {
        let retrieved = vec_of(&["a", "b", "c", "d"]);
        let relevant = set(&["b", "d", "z"]);
        assert_eq!(precision_at_k(&retrieved, &relevant, 4), 0.5);
        assert!((recall_at_k(&retrieved, &relevant, 4) - 2.0 / 3.0).abs() < 1e-9);
        assert_eq!(hit_rate_at_k(&retrieved, &relevant, 1), 0.0);
        assert_eq!(hit_rate_at_k(&retrieved, &relevant, 2), 1.0);
    }

    #[test]
    fn reciprocal_rank_first_hit() {
        let retrieved = vec_of(&["a", "b", "c"]);
        let relevant = set(&["c"]);
        assert!((reciprocal_rank(&retrieved, &relevant) - 1.0 / 3.0).abs() < 1e-9);
        assert_eq!(reciprocal_rank(&retrieved, &set(&["z"])), 0.0);
    }

    #[test]
    fn ndcg_perfect_ranking_is_one() {
        let retrieved = vec_of(&["a", "b", "c"]);
        let relevant = set(&["a", "b"]);
        assert!((ndcg_at_k(&retrieved, &relevant, 3) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn ndcg_no_relevant_is_zero() {
        let retrieved = vec_of(&["a", "b"]);
        assert_eq!(ndcg_at_k(&retrieved, &HashSet::new(), 2), 0.0);
    }

    #[test]
    fn empty_relevant_set_is_zero_everywhere() {
        let retrieved = vec_of(&["a"]);
        let relevant = HashSet::new();
        assert_eq!(recall_at_k(&retrieved, &relevant, 1), 0.0);
    }
}
