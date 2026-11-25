//! Component 5 — Sparse Input Preparation metrics (2 metrics) [optional].
//!
//! Term Coverage: fraction of unique terms from chunk surviving preprocessing.
//! Term Sparsity: fraction of terms with zero doc frequency in corpus.
//!
//! Skipped entirely when no sparse text is present in the sample.
//! Ported from `dist/quality/metrics/sparse-input.js` — IR-038.

use std::collections::{HashMap, HashSet};

use crate::quality::scoring::{normalize_monotonic_down, normalize_monotonic_up01};
use crate::quality::MetricResult;

const STOP_WORDS: &[&str] = &[
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
    "from", "is", "it", "this", "that", "be", "as",
];

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| c.is_whitespace() || !c.is_alphanumeric())
        .filter(|t| t.len() > 2)
        .map(|t| t.to_string())
        .collect()
}

fn preprocess_terms(tokens: &[String]) -> Vec<String> {
    let stop: HashSet<&str> = STOP_WORDS.iter().copied().collect();
    tokens
        .iter()
        .filter(|t| !stop.contains(t.as_str()))
        .cloned()
        .collect()
}

pub fn compute_sparse_input_metrics(
    sparse_texts: &[String],
    corpus_term_freqs: Option<&HashMap<String, usize>>,
) -> Vec<MetricResult> {
    if sparse_texts.is_empty() || sparse_texts.iter().all(|s| s.is_empty()) {
        return vec![
            MetricResult::skipped("TermCoverage", 1.0, "No sparseText found in sampled chunks"),
            MetricResult::skipped("TermSparsity", 0.5, "No sparseText found in sampled chunks"),
        ];
    }

    let mut coverage_scores = Vec::new();
    for sparse_text in sparse_texts {
        if sparse_text.is_empty() {
            continue;
        }
        let raw = tokenize(sparse_text);
        let unique: HashSet<String> = raw.into_iter().collect();
        let unique_vec: Vec<String> = unique.iter().cloned().collect();
        let surviving = preprocess_terms(&unique_vec);
        coverage_scores.push(if unique.is_empty() {
            0.0
        } else {
            surviving.len() as f64 / unique.len() as f64
        });
    }
    let term_coverage = if coverage_scores.is_empty() {
        0.0
    } else {
        coverage_scores.iter().sum::<f64>() / coverage_scores.len() as f64
    };

    let mut term_sparsity = 0.0;
    if let Some(corpus) = corpus_term_freqs {
        if !corpus.is_empty() {
            let mut all_terms = Vec::new();
            for sparse_text in sparse_texts {
                if !sparse_text.is_empty() {
                    all_terms.extend(tokenize(sparse_text));
                }
            }
            let unique_terms: HashSet<String> = all_terms.into_iter().collect();
            let zero_freq = unique_terms
                .iter()
                .filter(|t| corpus.get(*t).copied().unwrap_or(0) == 0)
                .count();
            term_sparsity = if unique_terms.is_empty() {
                0.0
            } else {
                zero_freq as f64 / unique_terms.len() as f64
            };
        }
    }

    vec![
        MetricResult::new(
            "TermCoverage",
            term_coverage,
            normalize_monotonic_up01(term_coverage),
            1.0,
        ),
        match corpus_term_freqs {
            Some(_) => MetricResult::new(
                "TermSparsity",
                term_sparsity,
                normalize_monotonic_down(term_sparsity),
                0.5,
            ),
            None => {
                MetricResult::skipped("TermSparsity", 0.5, "Corpus term frequencies not provided")
            }
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_sparse_texts_skips_both_metrics() {
        let results = compute_sparse_input_metrics(&[], None);
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|m| m.skipped));
    }

    #[test]
    fn all_blank_sparse_texts_skips_both_metrics() {
        let results = compute_sparse_input_metrics(&["".to_string(), "".to_string()], None);
        assert!(results.iter().all(|m| m.skipped));
    }

    #[test]
    fn stop_words_are_filtered_from_coverage() {
        let results = compute_sparse_input_metrics(&["the quick brown fox".to_string()], None);
        let coverage = results.iter().find(|m| m.name == "TermCoverage").unwrap();
        assert!(!coverage.skipped);
        // "the" is a stop word; "quick", "brown", "fox" survive → 3/4.
        assert!((coverage.raw_value - 0.75).abs() < 1e-9);
    }

    #[test]
    fn term_sparsity_skipped_without_corpus_freqs() {
        let results = compute_sparse_input_metrics(&["quick brown fox".to_string()], None);
        let sparsity = results.iter().find(|m| m.name == "TermSparsity").unwrap();
        assert!(sparsity.skipped);
    }

    #[test]
    fn term_sparsity_counts_zero_frequency_terms() {
        let mut freqs = HashMap::new();
        freqs.insert("quick".to_string(), 5);
        let results = compute_sparse_input_metrics(&["quick brown fox".to_string()], Some(&freqs));
        let sparsity = results.iter().find(|m| m.name == "TermSparsity").unwrap();
        assert!(!sparsity.skipped);
        // "brown" and "fox" have zero corpus frequency → 2/3.
        assert!((sparsity.raw_value - (2.0 / 3.0)).abs() < 1e-9);
    }
}
