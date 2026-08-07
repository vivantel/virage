//! Component 2 — Metadata Extraction metrics (5 metrics).
//!
//! Completeness:          fraction of expected fields non-empty per chunk.
//! Breadcrumb Consistency: common breadcrumb prefix within each file.
//! FQN Completeness:      fraction of code chunks with non-empty FQN.
//! Import Resolution:     fraction of import statements resolved to real files. (must-pass)
//! Sibling Integrity:     fraction of sibling links (prev/next) pointing to existing chunks.
//!
//! Ported from `dist/quality/metrics/metadata.js` — IR-038.

use std::collections::{HashMap, HashSet};

use crate::quality::scoring::normalize_monotonic_up01;
use crate::quality::{meta_f64, meta_str, meta_str_array, MetricResult, QualityChunk};

// Field names match the CE walk chunker's actual metadata keys (`chunkers/walk.rs`), not
// the JS predecessor's — `fqn`/`imports` aren't populated by any CE chunker yet, so those
// two components always report skipped/zero until a language chunker adds them.
const EXPECTED_FIELDS: [&str; 4] = ["breadcrumb", "fqn", "imports", "siblings"];

fn field_non_empty(m: &HashMap<String, serde_json::Value>, field: &str) -> bool {
    if field == "siblings" {
        return m.contains_key("siblingPrev") || m.contains_key("siblingNext");
    }
    match m.get(field) {
        None => false,
        Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::String(s)) => !s.is_empty(),
        Some(serde_json::Value::Array(a)) => !a.is_empty(),
        Some(_) => true,
    }
}

fn compute_completeness(chunks: &[QualityChunk]) -> f64 {
    if chunks.is_empty() {
        return 0.0;
    }
    let mut total_fields = 0;
    let mut non_empty = 0;
    for chunk in chunks {
        for field in EXPECTED_FIELDS {
            total_fields += 1;
            if field_non_empty(&chunk.metadata, field) {
                non_empty += 1;
            }
        }
    }
    if total_fields == 0 {
        0.0
    } else {
        non_empty as f64 / total_fields as f64
    }
}

fn compute_breadcrumb_consistency(chunks: &[QualityChunk]) -> f64 {
    let mut by_file: HashMap<String, Vec<Vec<String>>> = HashMap::new();
    for chunk in chunks {
        let Some(source_file) = chunk.source_file.clone() else {
            continue;
        };
        let Some(breadcrumb) = meta_str_array(&chunk.metadata, "breadcrumb") else {
            continue;
        };
        by_file.entry(source_file).or_default().push(breadcrumb);
    }
    if by_file.is_empty() {
        return 0.0;
    }
    let mut file_scores = Vec::new();
    for crumbs in by_file.values() {
        if crumbs.is_empty() {
            continue;
        }
        let max_len = crumbs.iter().map(|c| c.len()).max().unwrap_or(0);
        if max_len == 0 {
            file_scores.push(1.0);
            continue;
        }
        let reference = &crumbs[0];
        let mut common_len = 0;
        for i in 0..reference.len() {
            if crumbs.iter().all(|c| c.get(i) == reference.get(i)) {
                common_len = i + 1;
            } else {
                break;
            }
        }
        file_scores.push(common_len as f64 / max_len as f64);
    }
    if file_scores.is_empty() {
        0.0
    } else {
        file_scores.iter().sum::<f64>() / file_scores.len() as f64
    }
}

fn compute_fqn_completeness(chunks: &[QualityChunk]) -> Option<f64> {
    // "isCode" isn't a stored key — the walk chunker marks code chunks via presence of
    // "codeLanguage" instead (`chunkers/walk.rs`).
    let code_chunks: Vec<&QualityChunk> = chunks
        .iter()
        .filter(|c| c.metadata.contains_key("codeLanguage"))
        .collect();
    if code_chunks.is_empty() {
        return None;
    }
    let with_fqn = code_chunks
        .iter()
        .filter(|c| {
            meta_str(&c.metadata, "fqn")
                .map(|s| !s.is_empty())
                .unwrap_or(false)
        })
        .count();
    Some(with_fqn as f64 / code_chunks.len() as f64)
}

fn compute_import_resolution(chunks: &[QualityChunk]) -> Option<f64> {
    let mut total = 0.0;
    let mut resolved = 0.0;
    for chunk in chunks {
        if let Some(total_imports) = meta_f64(&chunk.metadata, "totalImports") {
            total += total_imports;
            resolved += meta_f64(&chunk.metadata, "resolvedImports").unwrap_or(0.0);
        }
    }
    if total == 0.0 {
        None
    } else {
        Some(resolved / total)
    }
}

fn compute_sibling_integrity(
    chunks: &[QualityChunk],
    chunk_id_set: &HashSet<String>,
) -> Option<f64> {
    let mut total_links = 0;
    let mut valid_links = 0;
    for chunk in chunks {
        if let Some(prev_id) = meta_str(&chunk.metadata, "siblingPrev") {
            total_links += 1;
            if chunk_id_set.contains(&prev_id) {
                valid_links += 1;
            }
        }
        if let Some(next_id) = meta_str(&chunk.metadata, "siblingNext") {
            total_links += 1;
            if chunk_id_set.contains(&next_id) {
                valid_links += 1;
            }
        }
    }
    if total_links == 0 {
        None
    } else {
        Some(valid_links as f64 / total_links as f64)
    }
}

pub fn compute_metadata_metrics(
    chunks: &[QualityChunk],
    chunk_id_set: &HashSet<String>,
    import_threshold: f64,
) -> Vec<MetricResult> {
    let completeness = compute_completeness(chunks);
    let breadcrumb_consistency = compute_breadcrumb_consistency(chunks);
    let fqn_completeness = compute_fqn_completeness(chunks);
    let import_resolution = compute_import_resolution(chunks);
    let sibling_integrity = compute_sibling_integrity(chunks, chunk_id_set);

    let mut results = Vec::with_capacity(5);
    results.push(MetricResult::new(
        "Completeness",
        completeness,
        normalize_monotonic_up01(completeness),
        1.0,
    ));
    results.push(MetricResult::new(
        "BreadcrumbConsistency",
        breadcrumb_consistency,
        normalize_monotonic_up01(breadcrumb_consistency),
        1.0,
    ));
    results.push(match fqn_completeness {
        Some(v) => MetricResult::new("FQNCompleteness", v, normalize_monotonic_up01(v), 1.0),
        None => MetricResult::skipped("FQNCompleteness", 1.0, "No code chunks found in sample"),
    });
    results.push(match import_resolution {
        Some(v) => MetricResult::new("ImportResolution", v, normalize_monotonic_up01(v), 1.0)
            .with_must_pass(import_threshold, v > import_threshold),
        None => {
            let mut m = MetricResult::skipped(
                "ImportResolution",
                1.0,
                "No import statements found in metadata",
            );
            m.must_pass = true;
            m.must_pass_threshold = Some(import_threshold);
            m
        }
    });
    results.push(match sibling_integrity {
        Some(v) => MetricResult::new("SiblingIntegrity", v, normalize_monotonic_up01(v), 0.5),
        None => MetricResult::skipped(
            "SiblingIntegrity",
            0.5,
            "No sibling links found in chunk metadata",
        ),
    });
    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn chunk(source_file: &str, metadata: HashMap<String, serde_json::Value>) -> QualityChunk {
        QualityChunk {
            id: format!("id-{source_file}"),
            dense_text: String::new(),
            sparse_text: String::new(),
            metadata,
            source_file: Some(source_file.to_string()),
        }
    }

    #[test]
    fn sibling_integrity_none_when_no_links() {
        let chunks = vec![chunk("a.rs", HashMap::new())];
        assert_eq!(compute_sibling_integrity(&chunks, &HashSet::new()), None);
    }

    #[test]
    fn sibling_integrity_counts_valid_links() {
        let mut ids = HashSet::new();
        ids.insert("prev-id".to_string());
        let mut meta = HashMap::new();
        meta.insert("siblingPrev".to_string(), json!("prev-id"));
        meta.insert("siblingNext".to_string(), json!("missing-id"));
        let chunks = vec![chunk("a.rs", meta)];
        // One of two links resolves.
        assert_eq!(compute_sibling_integrity(&chunks, &ids), Some(0.5));
    }

    #[test]
    fn fqn_completeness_none_without_code_chunks() {
        let chunks = vec![chunk("a.md", HashMap::new())];
        assert_eq!(compute_fqn_completeness(&chunks), None);
    }

    #[test]
    fn fqn_completeness_counts_code_chunks_with_fqn() {
        let mut with_fqn = HashMap::new();
        with_fqn.insert("codeLanguage".to_string(), json!("rust"));
        with_fqn.insert("fqn".to_string(), json!("crate::foo::bar"));
        let mut without_fqn = HashMap::new();
        without_fqn.insert("codeLanguage".to_string(), json!("rust"));
        let chunks = vec![chunk("a.rs", with_fqn), chunk("b.rs", without_fqn)];
        assert_eq!(compute_fqn_completeness(&chunks), Some(0.5));
    }

    #[test]
    fn import_resolution_none_without_import_metadata() {
        let chunks = vec![chunk("a.rs", HashMap::new())];
        assert_eq!(compute_import_resolution(&chunks), None);
    }

    #[test]
    fn breadcrumb_consistency_full_when_identical_within_file() {
        let mut meta = HashMap::new();
        meta.insert("breadcrumb".to_string(), json!(["mod", "foo"]));
        let chunks = vec![chunk("a.rs", meta.clone()), chunk("a.rs", meta)];
        assert_eq!(compute_breadcrumb_consistency(&chunks), 1.0);
    }

    #[test]
    fn completeness_is_zero_for_empty_chunks() {
        assert_eq!(compute_completeness(&[]), 0.0);
    }

    #[test]
    fn compute_metadata_metrics_flags_import_resolution_must_pass() {
        let results = compute_metadata_metrics(&[], &HashSet::new(), 0.7);
        let import = results
            .iter()
            .find(|m| m.name == "ImportResolution")
            .unwrap();
        assert!(import.must_pass);
        assert!(import.skipped);
    }
}
