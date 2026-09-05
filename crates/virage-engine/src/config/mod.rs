use std::collections::HashMap;

use indexmap::IndexMap;
use serde::Deserialize;
use serde_json::Value;

// ─── Config structs ───────────────────────────────────────────────────────────

/// Top-level `virage.config.json` structure.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirageConfigJson {
    pub version: Option<String>,
    pub install_scope: Option<String>,
    /// Named source providers (v2). Filesets reference these by name via `SourceRef::Named`.
    /// Absent in v1 configs — falls back to `providers.source` or auto-detect.
    #[serde(default)]
    pub sources: IndexMap<String, PluginRef>,
    pub providers: ProvidersConfig,
    #[serde(default)]
    pub file_sets: Vec<FileSetConfig>,
    #[serde(default)]
    pub ignore: Vec<String>,
    pub search: Option<SearchConfig>,
    pub pipeline: Option<PipelineOptions>,
    pub logging: Option<LoggingOptions>,
    /// Glob-matched tag rules, applied to every indexed item regardless of file set
    /// (IR-037). Evaluated in list order; all matches union into the item's tags.
    #[serde(default)]
    pub label_rules: Vec<LabelRule>,
    /// Must-pass gate threshold overrides for `virage quality run --ci` (IR-038). Absent
    /// fields fall back to the JS-predecessor defaults in `QualityThresholds`'s associated
    /// constants.
    pub quality: Option<QualityThresholds>,
    /// Must-pass gate threshold override for `virage eval run --ci` (IR-038). Absent field
    /// falls back to `EvalThresholds::DEFAULT_MIN_MRR`.
    pub eval: Option<EvalThresholds>,
    /// Must-pass gate threshold override for `virage bench index --ci` (IR-038 Step 6). Absent
    /// field falls back to `BenchThresholds::DEFAULT_MAX_REGRESSION_PCT`.
    pub bench: Option<BenchThresholds>,
}

/// A single glob → tags rule (IR-037). `pattern` is matched against each item's
/// source-relative path via the same glob engine as `FileSetConfig.include`/`ignore`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelRule {
    #[serde(rename = "match")]
    pub pattern: String,
    #[serde(default)]
    pub add: Vec<String>,
}

/// Reference to a built-in or plugin provider.
///
/// Accepts two forms in config:
/// - `{ "package": "@vivantel/virage-embedder-onnx", "options": { ... } }`
/// - `{ "builtin": "onnx", "options": { ... } }` — shorthand, resolved to the full package name
#[derive(Debug, Clone)]
pub struct PluginRef {
    /// Resolved package name (builtin keys are expanded at parse time).
    pub package: String,
    /// Plugin-specific options; deserialized into typed structs in resolve.rs.
    pub options: HashMap<String, Value>,
}

impl PluginRef {
    pub fn usize_opt(&self, key: &str) -> Option<usize> {
        self.options
            .get(key)
            .and_then(|v| v.as_u64())
            .map(|n| n as usize)
    }
}

impl<'de> serde::Deserialize<'de> for PluginRef {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        use serde::de::Error as _;
        #[derive(Deserialize)]
        struct Raw {
            package: Option<String>,
            builtin: Option<String>,
            #[serde(default)]
            options: HashMap<String, Value>,
        }
        let raw = Raw::deserialize(d)?;
        let package = match (raw.package, raw.builtin) {
            (Some(pkg), _) => pkg,
            (None, Some(key)) => builtin_to_package(&key)
                .ok_or_else(|| D::Error::custom(format!("unknown builtin key {key:?}")))?
                .to_string(),
            (None, None) => {
                return Err(D::Error::custom(
                    "plugin ref must specify either \"package\" or \"builtin\"",
                ))
            }
        };
        Ok(PluginRef {
            package,
            options: raw.options,
        })
    }
}

/// Map `builtin:` shorthand keys to canonical npm package names.
/// These package names are then matched by substring in resolve.rs.
fn builtin_to_package(key: &str) -> Option<&'static str> {
    match key {
        "onnx" => Some("@vivantel/virage-embedder-onnx"),
        "fastembed" => Some("@vivantel/virage-embedder-fastembed"),
        "lancedb" => Some("@vivantel/virage-store-lancedb"),
        "qdrant" => Some("@vivantel/virage-store-qdrant"),
        "postgres" | "pgvector" => Some("@vivantel/virage-store-postgres"),
        "chromadb" | "chroma" => Some("@vivantel/virage-store-chromadb"),
        "md" | "markdown" => Some("@vivantel/virage-chunker-ce-md"),
        "pdf" => Some("@vivantel/virage-chunker-ce-pdf"),
        "docx" | "word" => Some("@vivantel/virage-chunker-ce-docx"),
        "latex" | "tex" => Some("@vivantel/virage-chunker-ce-latex"),
        "lang" | "code" => Some("@vivantel/virage-chunker-ce-lang"),
        "cross-encoder" => Some("@vivantel/virage-reranker-cross-encoder"),
        "llm-reranker" | "llm" => Some("@vivantel/virage-reranker-llm"),
        "git" => Some("@vivantel/virage-source-git"),
        "localfs" | "local" => Some("@vivantel/virage-source-localfs"),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersConfig {
    pub embedder: PluginRef,
    pub query_embedder: Option<PluginRef>,
    pub vector_store: PluginRef,
    pub reranker: Option<PluginRef>,
    pub source: Option<PluginRef>,
}

/// How a fileset specifies its source provider.
///
/// - `Named(name)` — v2: look up `name` in the top-level `sources` map.
/// - `Inline(ref)` — v1 compat: inline plugin ref, same as the old `source` field shape.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum SourceRef {
    Named(String),
    Inline(PluginRef),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSetConfig {
    pub name: String,
    pub source: Option<SourceRef>,
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub ignore: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub chunkers: Vec<PluginRef>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchConfig {
    pub hybrid: Option<bool>,
    pub hybrid_alpha: Option<f32>,
    pub min_similarity: Option<f32>,
    pub rerank_oversample: Option<usize>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoggingOptions {
    /// `tracing_subscriber::EnvFilter` directive string. Defaults to `"info"` when the whole
    /// `logging` block is absent; `RUST_LOG` overrides this at runtime.
    pub level: Option<String>,
    /// Remote transport sinks. This crate parses but does not interpret this field — each
    /// entry's shape is transport-specific and resolved by whatever downstream consumer
    /// supports remote log transport, if any.
    #[serde(default)]
    pub transports: Vec<Value>,
}

/// Must-pass gate thresholds for the 26-metric quality health model (IR-038). Only the three
/// metrics the JS predecessor documented as must-pass are overridable here — the other 23
/// metrics are informational (weighted into the overall score, not individually gating).
/// Defaults match `dist/quality/metrics/{metadata,dense-embedding}.js`'s hardcoded values.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QualityThresholds {
    /// Minimum fraction of import statements resolved to real files. Default: 0.70.
    pub import_resolution_min: Option<f64>,
    /// Minimum Self-Recall@K (chunk-as-query retrieval hit rate). Default: 0.80.
    pub self_recall_min: Option<f64>,
    /// Maximum fraction of embedding-space outliers (no close neighbours). Default: 0.05.
    pub outlier_fraction_max: Option<f64>,
}

impl QualityThresholds {
    pub const DEFAULT_IMPORT_RESOLUTION_MIN: f64 = 0.70;
    pub const DEFAULT_SELF_RECALL_MIN: f64 = 0.80;
    pub const DEFAULT_OUTLIER_FRACTION_MAX: f64 = 0.05;

    pub fn import_resolution_min(&self) -> f64 {
        self.import_resolution_min
            .unwrap_or(Self::DEFAULT_IMPORT_RESOLUTION_MIN)
    }

    pub fn self_recall_min(&self) -> f64 {
        self.self_recall_min
            .unwrap_or(Self::DEFAULT_SELF_RECALL_MIN)
    }

    pub fn outlier_fraction_max(&self) -> f64 {
        self.outlier_fraction_max
            .unwrap_or(Self::DEFAULT_OUTLIER_FRACTION_MAX)
    }
}

/// Must-pass gate threshold for `virage eval run --ci` (IR-038). Unlike `QualityThresholds`,
/// there is no JS-predecessor value to inherit — RAGBench-subset MRR baselines depend heavily
/// on the configured embedder/corpus, so this default is a conservative v1 starting point, not
/// a derived value. Tune per-deployment.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EvalThresholds {
    /// Minimum macro-averaged MRR@K across evaluated subsets. Default: 0.30.
    pub min_mrr: Option<f64>,
}

impl EvalThresholds {
    pub const DEFAULT_MIN_MRR: f64 = 0.30;

    pub fn min_mrr(&self) -> f64 {
        self.min_mrr.unwrap_or(Self::DEFAULT_MIN_MRR)
    }
}

/// Must-pass gate threshold for `virage bench index --ci` (IR-038 Step 6). No JS predecessor
/// measured indexing throughput at all, so this default is a conservative v1 starting point —
/// tune per-deployment (CI runners are noisier than dedicated hardware).
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BenchThresholds {
    /// Maximum tolerated fractional drop in docs/sec vs. the previous recorded run for the
    /// same corpus path, e.g. `0.20` = fail if throughput drops by more than 20%. Default: 0.20.
    pub max_regression_pct: Option<f64>,
}

impl BenchThresholds {
    pub const DEFAULT_MAX_REGRESSION_PCT: f64 = 0.20;

    pub fn max_regression_pct(&self) -> f64 {
        self.max_regression_pct
            .unwrap_or(Self::DEFAULT_MAX_REGRESSION_PCT)
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PipelineOptions {
    pub force: Option<bool>,
    pub dry_run: Option<bool>,
    pub concurrency: Option<usize>,
    pub batch_size: Option<usize>,
    pub min_upload_batch_size: Option<usize>,
    /// ADR-057: explicit `ConcurrencyStrategy` selection — `"fixed"` or `"ramSampling"`.
    /// `None` falls back to each CLI command's own default (see
    /// `cli/index.rs::resolve_concurrency`'s `default_dynamic` parameter): `virage index`
    /// defaults to `ramSampling` when `concurrency` is unset; `virage bench index` defaults to
    /// `"fixed"` regardless, so throughput benchmarks stay deterministic across runs unless a
    /// caller explicitly opts into measuring the dynamic path. Unrecognized values fall back to
    /// each command's default rather than erroring — review with `virage validate` if unsure
    /// which one is active.
    pub concurrency_strategy: Option<String>,
}

// ─── Loader ───────────────────────────────────────────────────────────────────

pub fn load_config(path: &str) -> anyhow::Result<VirageConfigJson> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("Cannot read config {:?}: {e}", path))?;
    let cfg = serde_json::from_str::<VirageConfigJson>(&text)
        .map_err(|e| anyhow::anyhow!("Config parse error in {:?}: {e}", path))?;
    Ok(cfg)
}

/// Default config file candidates, searched in order.
pub const CONFIG_CANDIDATES: &[&str] = &["virage.config.json", ".virage/virage.config.json"];

/// Find the first config file that exists, or return `None`.
pub fn find_config() -> Option<String> {
    CONFIG_CANDIDATES
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .map(|s| s.to_string())
}

/// Default VirageDb path (`.virage/virage.db` relative to cwd).
pub fn default_db_path() -> String {
    ".virage/virage.db".to_string()
}

pub mod resolve;

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> VirageConfigJson {
        serde_json::from_str(json).expect("config parse failed")
    }

    #[test]
    fn v2_named_source_parses() {
        let cfg = parse(
            r#"{
            "version": "2",
            "sources": {
                "default": { "builtin": "git", "options": { "root": ".", "branch": "main" } }
            },
            "providers": {
                "embedder": { "builtin": "fastembed", "options": { "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 } },
                "vectorStore": { "builtin": "lancedb", "options": { "uri": ".virage/lancedb" } }
            },
            "fileSets": [
                { "name": "code", "source": "default", "include": ["**/*.rs"],
                  "chunkers": [{ "builtin": "lang", "options": { "maxTokens": 512 } }] }
            ]
        }"#,
        );
        assert_eq!(cfg.version.as_deref(), Some("2"));
        assert_eq!(cfg.sources.len(), 1);
        assert!(cfg.sources.contains_key("default"));
        assert_eq!(cfg.file_sets.len(), 1);
        let src = cfg.file_sets[0].source.as_ref().unwrap();
        assert!(matches!(src, SourceRef::Named(n) if n == "default"));
    }

    #[test]
    fn v1_inline_source_parses() {
        let cfg = parse(
            r#"{
            "providers": {
                "embedder": { "builtin": "fastembed", "options": { "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 } },
                "vectorStore": { "builtin": "lancedb", "options": { "uri": ".virage/lancedb" } },
                "source": { "builtin": "git", "options": { "root": "." } }
            },
            "fileSets": [
                { "name": "code", "include": ["**/*.rs"],
                  "chunkers": [{ "builtin": "lang", "options": { "maxTokens": 512 } }] }
            ]
        }"#,
        );
        assert!(cfg.sources.is_empty());
        assert!(cfg.file_sets[0].source.is_none());
        assert!(cfg.providers.source.is_some());
    }

    #[test]
    fn v1_inline_fileset_source_parses() {
        let cfg = parse(
            r#"{
            "providers": {
                "embedder": { "builtin": "fastembed", "options": { "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 } },
                "vectorStore": { "builtin": "lancedb", "options": { "uri": ".virage/lancedb" } }
            },
            "fileSets": [
                { "name": "code",
                  "source": { "builtin": "localfs", "options": { "root": "./src" } },
                  "include": ["**/*.rs"],
                  "chunkers": [{ "builtin": "lang" }] }
            ]
        }"#,
        );
        let src = cfg.file_sets[0].source.as_ref().unwrap();
        assert!(matches!(src, SourceRef::Inline(_)));
    }

    #[test]
    fn onnx_flat_model_parses() {
        // Verifies Bug 1 fix: model at top level (not nested under "source:")
        let cfg = parse(
            r#"{
            "providers": {
                "embedder": { "builtin": "onnx", "options": { "model": "Xenova/all-MiniLM-L6-v2", "dimensions": 384 } },
                "vectorStore": { "builtin": "lancedb" }
            },
            "fileSets": [{ "name": "code", "include": ["**/*.rs"], "chunkers": [{ "builtin": "lang" }] }]
        }"#,
        );
        let opts = &cfg.providers.embedder.options;
        assert_eq!(
            opts.get("model").and_then(|v| v.as_str()),
            Some("Xenova/all-MiniLM-L6-v2")
        );
    }

    #[test]
    fn reranker_flat_model_and_top_k_parse() {
        // Verifies Bug 2 fix: model + topK at top level
        let cfg = parse(
            r#"{
            "providers": {
                "embedder": { "builtin": "fastembed", "options": { "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 } },
                "vectorStore": { "builtin": "lancedb" },
                "reranker": { "builtin": "cross-encoder", "options": { "model": "cross-encoder/ms-marco-MiniLM-L-12-v2", "topK": 5 } }
            },
            "fileSets": [{ "name": "code", "include": ["**/*.rs"], "chunkers": [{ "builtin": "lang" }] }]
        }"#,
        );
        let opts = &cfg.providers.reranker.as_ref().unwrap().options;
        assert_eq!(
            opts.get("model").and_then(|v| v.as_str()),
            Some("cross-encoder/ms-marco-MiniLM-L-12-v2")
        );
        assert_eq!(opts.get("topK").and_then(|v| v.as_u64()), Some(5));
    }

    #[test]
    fn git_builtin_key_resolves() {
        // Verifies Bug 4 fix: "git" and "localfs" are valid builtin keys
        let cfg = parse(
            r#"{
            "providers": {
                "embedder": { "builtin": "fastembed", "options": { "model": "m", "dimensions": 384 } },
                "vectorStore": { "builtin": "lancedb" },
                "source": { "builtin": "git" }
            },
            "fileSets": [{ "name": "code", "include": ["**/*.rs"], "chunkers": [{ "builtin": "lang" }] }]
        }"#,
        );
        assert!(cfg.providers.source.is_some());
        assert!(cfg
            .providers
            .source
            .as_ref()
            .unwrap()
            .package
            .contains("source-git"));
    }
}
