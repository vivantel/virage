//! 26-metric pipeline-health model (IR-038). Ported from the JS predecessor
//! (`node_modules/@vivantel/virage-core/dist/quality/*`, see the EE-repo plan at
//! `docs/plans/eval-quality-bench-redesign.md`). Components 5-8 are optional; they
//! auto-skip when the corresponding pipeline feature isn't configured.

pub mod metrics;
pub mod report;
pub mod runner;
pub mod scoring;

use std::collections::HashMap;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricResult {
    pub name: String,
    pub raw_value: f64,
    pub normalized_value: f64,
    pub weight: f64,
    pub skipped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub must_pass: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub must_pass_threshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub must_pass_passed: Option<bool>,
}

impl MetricResult {
    pub fn new(name: &str, raw_value: f64, normalized_value: f64, weight: f64) -> Self {
        Self {
            name: name.to_string(),
            raw_value,
            normalized_value,
            weight,
            skipped: false,
            skip_reason: None,
            must_pass: false,
            must_pass_threshold: None,
            must_pass_passed: None,
        }
    }

    pub fn skipped(name: &str, weight: f64, reason: impl Into<String>) -> Self {
        Self {
            name: name.to_string(),
            raw_value: 0.0,
            normalized_value: 0.0,
            weight,
            skipped: true,
            skip_reason: Some(reason.into()),
            must_pass: false,
            must_pass_threshold: None,
            must_pass_passed: None,
        }
    }

    pub fn with_must_pass(mut self, threshold: f64, passed: bool) -> Self {
        self.must_pass = true;
        self.must_pass_threshold = Some(threshold);
        self.must_pass_passed = Some(passed);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ComponentId {
    Chunking,
    Metadata,
    DenseInput,
    DenseEmbedding,
    SparseInput,
    LexicalRetrieval,
    RerankerInput,
    Reranker,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentResult {
    pub id: ComponentId,
    pub label: String,
    pub score: f64,
    pub weight: f64,
    pub skipped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
    pub metrics: Vec<MetricResult>,
}

impl ComponentResult {
    pub fn new(
        id: ComponentId,
        label: &str,
        metrics: Vec<MetricResult>,
        weight: f64,
        skipped: bool,
        skip_reason: Option<String>,
    ) -> Self {
        let score = scoring::aggregate_component(&metrics);
        Self {
            id,
            label: label.to_string(),
            score,
            weight,
            skipped,
            skip_reason,
            metrics,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MustPassGate {
    pub metric_name: String,
    pub threshold: f64,
    pub value: f64,
    pub passed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum QualityStatus {
    Pass,
    Fail,
}

impl QualityStatus {
    pub fn is_pass(self) -> bool {
        self == QualityStatus::Pass
    }
}

impl std::fmt::Display for QualityStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QualityStatus::Pass => write!(f, "PASS"),
            QualityStatus::Fail => write!(f, "FAIL"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityReport {
    pub timestamp: String,
    pub overall_score: f64,
    pub status: QualityStatus,
    pub must_pass_gates: Vec<MustPassGate>,
    pub components: Vec<ComponentResult>,
    pub sample_size: usize,
    pub top_k: usize,
    pub config_file: String,
    pub duration_ms: u128,
}

/// Chunk snapshot used as input to the metric computations. Values are pulled from
/// `SearchResult`/`list_all` metadata, mirroring the JS predecessor's plain chunk shape.
#[derive(Debug, Clone, Default)]
pub struct QualityChunk {
    pub id: String,
    pub dense_text: String,
    pub sparse_text: String,
    pub metadata: HashMap<String, serde_json::Value>,
    pub source_file: Option<String>,
}

pub(crate) fn meta_str(m: &HashMap<String, serde_json::Value>, key: &str) -> Option<String> {
    m.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

pub(crate) fn meta_str_array(
    m: &HashMap<String, serde_json::Value>,
    key: &str,
) -> Option<Vec<String>> {
    m.get(key).and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect()
    })
}

pub(crate) fn meta_f64(m: &HashMap<String, serde_json::Value>, key: &str) -> Option<f64> {
    m.get(key).and_then(|v| v.as_f64())
}
