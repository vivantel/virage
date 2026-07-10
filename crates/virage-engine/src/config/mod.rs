use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

// ─── Config structs ───────────────────────────────────────────────────────────

/// Top-level `virage.config.json` structure.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirageConfigJson {
    pub version: Option<String>,
    pub install_scope: Option<String>,
    pub providers: ProvidersConfig,
    #[serde(default)]
    pub file_sets: Vec<FileSetConfig>,
    #[serde(default)]
    pub ignore: Vec<String>,
    pub search: Option<SearchConfig>,
    pub pipeline: Option<PipelineOptions>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSetConfig {
    pub name: String,
    pub source: Option<PluginRef>,
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
pub struct PipelineOptions {
    pub force: Option<bool>,
    pub dry_run: Option<bool>,
    pub concurrency: Option<usize>,
    pub batch_size: Option<usize>,
    pub min_upload_batch_size: Option<usize>,
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
