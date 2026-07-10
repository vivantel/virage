use std::path::Path;
use std::sync::Arc;

use anyhow::anyhow;
use serde::Deserialize;

use super::PluginRef;
use crate::embedders::Embedder;
use crate::sources::SourceProvider;
use crate::stores::VectorStore;

// ─── Typed option structs ─────────────────────────────────────────────────────

/// Deserialize a plugin's `options` map into a typed struct.
/// Unknown fields are rejected so typos surface at config parse time.
fn parse_options<T>(spec: &PluginRef) -> anyhow::Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    let val = serde_json::Value::Object(spec.options.clone().into_iter().collect());
    serde_json::from_value(val)
        .map_err(|e| anyhow!("{}: invalid options: {e}", spec.package))
}

// ── Embedder options ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OnnxEmbedderOptions {
    /// HuggingFace model ID (e.g. "Xenova/all-MiniLM-L6-v2"). Auto-downloads on first use.
    model: Option<String>,
    /// Local directory for downloaded model files (default: ".virage/model-cache").
    cache_dir: Option<String>,
    /// Explicit path to a local ONNX model file (alternative to `model`).
    model_path: Option<String>,
    /// Explicit path to a local tokenizer.json (required when `model_path` is set).
    tokenizer_path: Option<String>,
    #[serde(default = "default_onnx_dims")]
    dimensions: usize,
    max_length: Option<usize>,
    pooling: Option<String>,
    normalize: Option<bool>,
}

fn default_onnx_dims() -> usize {
    384
}

impl OnnxEmbedderOptions {
    #[cfg(feature = "embedder-onnx")]
    fn resolve_paths(&self) -> anyhow::Result<(String, String)> {
        if let Some(model_id) = &self.model {
            let cache = self.cache_dir.as_deref().unwrap_or(".virage/model-cache");
            download_hf_onnx_model(model_id, cache)
        } else {
            let mp = self
                .model_path
                .as_deref()
                .ok_or_else(|| anyhow!("embedder requires 'model' (HuggingFace ID) or 'modelPath'"))?;
            let tp = self
                .tokenizer_path
                .as_deref()
                .ok_or_else(|| anyhow!("embedder: 'tokenizerPath' is required when using 'modelPath'"))?;
            Ok((mp.to_string(), tp.to_string()))
        }
    }
}

// ── Vector store options ──────────────────────────────────────────────────────

#[cfg(feature = "store-lancedb")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LanceDbOptions {
    #[serde(default = "default_lancedb_uri")]
    uri: String,
    #[serde(default = "default_lancedb_table")]
    table_name: String,
}

#[cfg(feature = "store-lancedb")]
fn default_lancedb_uri() -> String {
    ".virage/lancedb".to_string()
}
#[cfg(feature = "store-lancedb")]
fn default_lancedb_table() -> String {
    "virage_chunks".to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QdrantOptions {
    #[serde(default = "default_qdrant_url")]
    url: String,
    #[serde(default = "default_qdrant_collection")]
    collection: String,
}

fn default_qdrant_url() -> String {
    "http://localhost:6334".to_string()
}
fn default_qdrant_collection() -> String {
    "virage".to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PostgresOptions {
    connection_string: String,
    #[serde(default = "default_postgres_table")]
    table: String,
}

fn default_postgres_table() -> String {
    "virage_chunks".to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChromaDbOptions {
    #[serde(default = "default_chroma_url")]
    base_url: String,
    #[serde(default = "default_chroma_collection")]
    collection_name: String,
}

fn default_chroma_url() -> String {
    "http://localhost:8000".to_string()
}
fn default_chroma_collection() -> String {
    "virage".to_string()
}

// ── Source provider options ───────────────────────────────────────────────────

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GitSourceOptions {
    root: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalFsSourceOptions {
    root: Option<String>,
}

// ─── Embedder resolution ──────────────────────────────────────────────────────

/// Instantiate a built-in `Embedder` from a `PluginRef`.
///
/// Supported packages (or `builtin:` shorthands):
/// - `@vivantel/virage-embedder-onnx` / `onnx`      → ONNX inference via ORT
/// - `@vivantel/virage-embedder-fastembed` / `fastembed` → same ORT backend
pub fn resolve_embedder(
    spec: &PluginRef,
) -> anyhow::Result<Arc<std::sync::Mutex<dyn Embedder + Send>>> {
    match spec.package.as_str() {
        p if p.contains("embedder-onnx") || p.contains("embedder-fastembed") => {
            #[cfg(feature = "embedder-onnx")]
            {
                let opts: OnnxEmbedderOptions = parse_options(spec)?;
                let (model_path, tokenizer_path) = opts.resolve_paths()?;
                let emb = crate::embedders::onnx::OnnxEmbedder::new(
                    &model_path,
                    &tokenizer_path,
                    opts.dimensions,
                    opts.max_length,
                    opts.pooling.as_deref(),
                    opts.normalize,
                )
                .map_err(|e| anyhow!("OnnxEmbedder init error: {e}"))?;
                Ok(Arc::new(std::sync::Mutex::new(emb)))
            }
            #[cfg(not(feature = "embedder-onnx"))]
            Err(anyhow!(
                "package {:?}: embedder-onnx feature not compiled in",
                spec.package
            ))
        }
        other => Err(anyhow!("unknown embedder package {:?}", other)),
    }
}

// ─── HuggingFace model download ───────────────────────────────────────────────

#[cfg(feature = "embedder-onnx")]
fn download_hf_onnx_model(model_id: &str, cache_dir: &str) -> anyhow::Result<(String, String)> {
    use hf_hub::api::sync::ApiBuilder;
    std::fs::create_dir_all(cache_dir)
        .map_err(|e| anyhow!("Cannot create model cache dir {cache_dir:?}: {e}"))?;
    let api = ApiBuilder::new()
        .with_cache_dir(std::path::PathBuf::from(cache_dir))
        .build()
        .map_err(|e| anyhow!("HuggingFace API init error: {e}"))?;
    let repo = api.model(model_id.to_string());
    // Prefer quantized (int8) ONNX model — half the size, nearly identical quality.
    let model_path = repo
        .get("onnx/model_quantized.onnx")
        .or_else(|_| repo.get("onnx/model.onnx"))
        .map_err(|e| anyhow!("Failed to download ONNX model for {model_id:?}: {e}"))?;
    let tokenizer_path = repo
        .get("tokenizer.json")
        .map_err(|e| anyhow!("Failed to download tokenizer for {model_id:?}: {e}"))?;
    Ok((
        model_path.to_string_lossy().into_owned(),
        tokenizer_path.to_string_lossy().into_owned(),
    ))
}

// ─── Vector store resolution ──────────────────────────────────────────────────

/// Instantiate a built-in `VectorStore` from a `PluginRef` and embedding dims.
///
/// Supported packages (or `builtin:` shorthands):
/// - `@vivantel/virage-store-qdrant`    / `qdrant`    → QdrantStore
/// - `@vivantel/virage-store-postgres`  / `postgres`  → PostgresStore
/// - `@vivantel/virage-store-chromadb`  / `chromadb`  → ChromaDbStore
/// - `@vivantel/virage-store-lancedb`   / `lancedb`   → LanceDbStore
pub fn resolve_store(spec: &PluginRef, dims: usize) -> anyhow::Result<Arc<dyn VectorStore>> {
    match spec.package.as_str() {
        p if p.contains("store-qdrant") => {
            #[cfg(feature = "store-qdrant")]
            {
                let opts: QdrantOptions = parse_options(spec)?;
                Ok(Arc::new(crate::stores::qdrant::QdrantStore::new(
                    &opts.url,
                    &opts.collection,
                    dims,
                )))
            }
            #[cfg(not(feature = "store-qdrant"))]
            Err(anyhow!("store-qdrant feature not compiled in"))
        }
        p if p.contains("store-postgres") || p.contains("store-pgvector") => {
            #[cfg(feature = "store-postgres")]
            {
                let opts: PostgresOptions = parse_options(spec)?;
                Ok(Arc::new(crate::stores::postgres::PostgresStore::new(
                    &opts.connection_string,
                    &opts.table,
                    dims,
                )))
            }
            #[cfg(not(feature = "store-postgres"))]
            Err(anyhow!("store-postgres feature not compiled in"))
        }
        p if p.contains("store-chromadb") => {
            #[cfg(feature = "store-chromadb")]
            {
                let opts: ChromaDbOptions = parse_options(spec)?;
                Ok(Arc::new(crate::stores::chromadb::ChromaDbStore::new(
                    &opts.base_url,
                    &opts.collection_name,
                )))
            }
            #[cfg(not(feature = "store-chromadb"))]
            Err(anyhow!("store-chromadb feature not compiled in"))
        }
        p if p.contains("store-lancedb") => {
            #[cfg(feature = "store-lancedb")]
            {
                let opts: LanceDbOptions = parse_options(spec)?;
                Ok(Arc::new(crate::stores::lancedb::LanceDbStore::new(
                    &opts.uri,
                    &opts.table_name,
                    dims,
                )))
            }
            #[cfg(not(feature = "store-lancedb"))]
            Err(anyhow!(
                "package {:?}: store-lancedb feature not compiled in (requires ≥4GB RAM to build)",
                spec.package
            ))
        }
        other => Err(anyhow!("unknown vector store package {:?}", other)),
    }
}

// ─── Source provider resolution ───────────────────────────────────────────────

/// Instantiate a built-in `SourceProvider` from a `PluginRef` and fallback cwd.
///
/// Supported packages (or `builtin:` shorthands):
/// - `@vivantel/virage-source-git`     → GitSourceProvider
/// - `@vivantel/virage-source-localfs` → LocalFsSourceProvider
///
/// If `spec` is `None`, defaults to `LocalFsSourceProvider` at `cwd`.
pub fn resolve_source(
    spec: Option<&PluginRef>,
    cwd: &Path,
) -> anyhow::Result<Arc<dyn SourceProvider>> {
    match spec {
        None => resolve_default_source(cwd),
        Some(p) if p.package.contains("source-git") => {
            #[cfg(feature = "source-git")]
            {
                let opts: GitSourceOptions = parse_options(p)?;
                let root = opts.root.as_deref().map(Path::new).unwrap_or(cwd);
                let provider = crate::sources::git::GitSourceProvider::open(root, "git")?;
                Ok(Arc::new(provider))
            }
            #[cfg(not(feature = "source-git"))]
            Err(anyhow!("source-git feature not compiled in"))
        }
        Some(p) if p.package.contains("source-localfs") => {
            #[cfg(feature = "source-localfs")]
            {
                let opts: LocalFsSourceOptions = parse_options(p)?;
                let root = opts.root.as_deref().map(Path::new).unwrap_or(cwd);
                Ok(Arc::new(
                    crate::sources::local_fs::LocalFsSourceProvider::new(root, "localfs"),
                ))
            }
            #[cfg(not(feature = "source-localfs"))]
            Err(anyhow!("source-localfs feature not compiled in"))
        }
        Some(p) => Err(anyhow!("unknown source package {:?}", p.package)),
    }
}

fn resolve_default_source(cwd: &Path) -> anyhow::Result<Arc<dyn SourceProvider>> {
    #[cfg(feature = "source-git")]
    if git2::Repository::open(cwd).is_ok() {
        let provider = crate::sources::git::GitSourceProvider::open(cwd, "git")?;
        return Ok(Arc::new(provider));
    }
    #[cfg(feature = "source-localfs")]
    {
        return Ok(Arc::new(
            crate::sources::local_fs::LocalFsSourceProvider::new(cwd, "localfs"),
        ));
    }
    #[allow(unreachable_code)]
    Err(anyhow!("no source feature compiled in"))
}
