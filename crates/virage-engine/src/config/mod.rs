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
#[derive(Debug, Deserialize, Clone)]
pub struct PluginRef {
    pub package: String,
    #[serde(default)]
    pub options: HashMap<String, Value>,
}

impl PluginRef {
    pub fn str_opt<'a>(&'a self, key: &str) -> Option<&'a str> {
        self.options.get(key).and_then(|v| v.as_str())
    }

    pub fn str_req(&self, key: &str) -> anyhow::Result<&str> {
        self.str_opt(key).ok_or_else(|| {
            anyhow::anyhow!("plugin {}: missing required option {:?}", self.package, key)
        })
    }

    pub fn u64_opt(&self, key: &str) -> Option<u64> {
        self.options.get(key).and_then(|v| v.as_u64())
    }

    pub fn usize_opt(&self, key: &str) -> Option<usize> {
        self.u64_opt(key).map(|n| n as usize)
    }

    pub fn bool_opt(&self, key: &str) -> Option<bool> {
        self.options.get(key).and_then(|v| v.as_bool())
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
