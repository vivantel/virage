use std::path::Path;
use std::sync::Arc;

use anyhow::anyhow;
use serde::Deserialize;

use super::PluginRef;
use crate::embedders::Embedder;
use crate::sources::SourceProvider;
use crate::stores::VectorStore;

// ─── Typed option structs ─────────────────────────────────────────────────────

fn parse_options<T>(spec: &PluginRef) -> anyhow::Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    let val = serde_json::Value::Object(spec.options.clone().into_iter().collect());
    serde_json::from_value(val).map_err(|e| anyhow!("{}: invalid options: {e}", spec.package))
}

// ── ONNX model source — three mutually exclusive variants ─────────────────────

/// Where to load the ONNX model and tokenizer from.
/// Exactly one variant must match (untagged — discriminated by required fields).
#[derive(Deserialize)]
#[serde(untagged)]
pub enum OnnxModelSource {
    /// Download from HuggingFace Hub on first use.
    #[serde(rename_all = "camelCase")]
    HuggingFace {
        model: String,
        /// Specific ONNX file within the repo (default: tries quantized, then full).
        model_file: Option<String>,
        /// Tokenizer file within the repo (default: "tokenizer.json").
        tokenizer_file: Option<String>,
        /// Local cache directory (default: ".virage/model-cache").
        cache_dir: Option<String>,
    },
    /// Download from arbitrary URLs (model and tokenizer served separately).
    #[serde(rename_all = "camelCase")]
    Url {
        model_url: String,
        tokenizer_url: String,
        cache_dir: Option<String>,
    },
    /// Use files already on disk.
    #[serde(rename_all = "camelCase")]
    Local {
        model_path: String,
        tokenizer_path: String,
    },
}

#[cfg(feature = "embedder-onnx")]
impl OnnxModelSource {
    fn resolve_paths(&self) -> anyhow::Result<(String, String)> {
        match self {
            OnnxModelSource::HuggingFace {
                model,
                model_file,
                tokenizer_file,
                cache_dir,
            } => {
                let cache = cache_dir.as_deref().unwrap_or(".virage/model-cache");
                let tok = tokenizer_file.as_deref().unwrap_or("tokenizer.json");
                download_hf(model, cache, model_file.as_deref(), tok)
            }
            OnnxModelSource::Url {
                model_url,
                tokenizer_url,
                cache_dir: _,
            } => {
                anyhow::bail!(
                    "URL model download not yet implemented \
                     (modelUrl={model_url:?}, tokenizerUrl={tokenizer_url:?}); \
                     use 'model' for HuggingFace or 'modelPath'/'tokenizerPath' for local files"
                )
            }
            OnnxModelSource::Local {
                model_path,
                tokenizer_path,
            } => Ok((model_path.clone(), tokenizer_path.clone())),
        }
    }
}

#[cfg(feature = "embedder-onnx")]
fn download_hf(
    model_id: &str,
    cache_dir: &str,
    model_file: Option<&str>,
    tokenizer_file: &str,
) -> anyhow::Result<(String, String)> {
    // Cache layout: {cache_dir}/models--{owner}--{name}/{safe_filename}
    // (safe_filename replaces "/" with "--" so paths stay flat)
    let model_slug = format!("models--{}", model_id.replace('/', "--"));
    let model_cache = std::path::Path::new(cache_dir).join(&model_slug);
    std::fs::create_dir_all(&model_cache)
        .map_err(|e| anyhow!("Cannot create model cache dir {model_cache:?}: {e}"))?;

    let tok_dest = model_cache.join(tokenizer_file.replace('/', "--"));
    if !tok_dest.exists() {
        hf_download(model_id, tokenizer_file, &tok_dest)?;
    }

    let onnx_dest = if let Some(file) = model_file {
        let dest = model_cache.join(file.replace('/', "--"));
        if !dest.exists() {
            hf_download(model_id, file, &dest)
                .map_err(|e| anyhow!("Failed to download {file:?} from {model_id:?}: {e}"))?;
        }
        dest
    } else {
        // Prefer quantized (int8) — fall back to full model.
        let q_dest = model_cache.join("onnx--model_quantized.onnx");
        if q_dest.exists() {
            q_dest
        } else if hf_download(model_id, "onnx/model_quantized.onnx", &q_dest).is_ok() {
            q_dest
        } else {
            let f_dest = model_cache.join("onnx--model.onnx");
            if !f_dest.exists() {
                hf_download(model_id, "onnx/model.onnx", &f_dest)
                    .map_err(|e| anyhow!("Failed to download ONNX model for {model_id:?}: {e}"))?;
            }
            f_dest
        }
    };

    Ok((
        onnx_dest.to_string_lossy().into_owned(),
        tok_dest.to_string_lossy().into_owned(),
    ))
}

#[cfg(feature = "embedder-onnx")]
fn hf_download(model_id: &str, filename: &str, dest: &std::path::Path) -> anyhow::Result<()> {
    let url = format!("https://huggingface.co/{model_id}/resolve/main/{filename}");
    let resp = ureq::get(&url)
        .call()
        .map_err(|e| anyhow!("Failed to download {filename:?} for {model_id:?}: {e}"))?;
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(dest)
        .map_err(|e| anyhow!("Cannot create cache file {dest:?}: {e}"))?;
    std::io::copy(&mut reader, &mut file)
        .map_err(|e| anyhow!("Failed to write {filename:?}: {e}"))?;
    Ok(())
}

// ── Embedder options ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OnnxEmbedderOptions {
    source: OnnxModelSource,
    #[serde(default = "default_onnx_dims")]
    dimensions: usize,
    max_length: Option<usize>,
    /// Pooling strategy: "mean" (default) or "cls".
    pooling: Option<String>,
    #[serde(default = "default_true")]
    normalize: bool,
}

fn default_onnx_dims() -> usize {
    384
}

fn default_true() -> bool {
    true
}

// ── Cross-encoder reranker options ────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CrossEncoderOptions {
    source: OnnxModelSource,
    max_length: Option<usize>,
    /// Score activation: "none" (default), "sigmoid", or "softmax".
    activation: Option<String>,
    /// Index into the logits vector to use as the relevance score (default: 0).
    #[serde(default)]
    score_index: usize,
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
/// - `@vivantel/virage-embedder-onnx` / `onnx`       → ONNX inference via ORT
/// - `@vivantel/virage-embedder-fastembed` / `fastembed` → same ORT backend
pub fn resolve_embedder(
    spec: &PluginRef,
) -> anyhow::Result<Arc<std::sync::Mutex<dyn Embedder + Send>>> {
    match spec.package.as_str() {
        p if p.contains("embedder-onnx") || p.contains("embedder-fastembed") => {
            #[cfg(feature = "embedder-onnx")]
            {
                use crate::onnx::{OnnxInferenceSession, Pooling};
                let opts: OnnxEmbedderOptions = parse_options(spec)?;
                let (model_path, tokenizer_path) = opts.source.resolve_paths()?;
                let session = OnnxInferenceSession::from_paths(&model_path, &tokenizer_path)
                    .map_err(|e| anyhow!("OnnxEmbedder session init error: {e}"))?;
                let pooling = match opts.pooling.as_deref() {
                    Some("cls") => Pooling::Cls,
                    _ => Pooling::Mean,
                };
                let emb = crate::embedders::onnx::OnnxEmbedder::new(
                    session,
                    opts.dimensions,
                    opts.max_length.unwrap_or(512),
                    pooling,
                    opts.normalize,
                );
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

// ─── Reranker resolution ──────────────────────────────────────────────────────

/// Instantiate a built-in `Reranker` from a `PluginRef`.
///
/// Supported packages (or `builtin:` shorthands):
/// - `@vivantel/virage-reranker-cross-encoder` / `cross-encoder` → CrossEncoderReranker
#[cfg(feature = "embedder-onnx")]
pub fn resolve_reranker(
    spec: &PluginRef,
) -> anyhow::Result<Arc<std::sync::Mutex<dyn crate::rerankers::Reranker + Send>>> {
    use crate::onnx::{OnnxInferenceSession, ScoreActivation};

    match spec.package.as_str() {
        p if p.contains("reranker-cross-encoder") => {
            let opts: CrossEncoderOptions = parse_options(spec)?;
            let (model_path, tokenizer_path) = opts.source.resolve_paths()?;
            let session = OnnxInferenceSession::from_paths(&model_path, &tokenizer_path)
                .map_err(|e| anyhow!("CrossEncoderReranker session init error: {e}"))?;
            let activation = match opts.activation.as_deref() {
                Some("sigmoid") => ScoreActivation::Sigmoid,
                Some("softmax") => ScoreActivation::Softmax,
                _ => ScoreActivation::None,
            };
            let reranker = crate::rerankers::cross_encoder::CrossEncoderReranker::new(
                session,
                opts.max_length.unwrap_or(512),
                activation,
                opts.score_index,
            );
            Ok(Arc::new(std::sync::Mutex::new(reranker)))
        }
        other => Err(anyhow!("unknown reranker package {:?}", other)),
    }
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
