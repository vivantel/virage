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
