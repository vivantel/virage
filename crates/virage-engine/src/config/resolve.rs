use std::path::Path;
use std::sync::Arc;

use anyhow::anyhow;
use serde::Deserialize;

use super::{PluginRef, SourceRef};
use crate::embedders::Embedder;
use crate::sources::SourceProvider;
use crate::stores::VectorStore;

// ─── Typed option structs ─────────────────────────────────────────────────────

fn parse_options<T>(spec: &PluginRef) -> anyhow::Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    let val = serde_json::Value::Object(spec.options.clone().into_iter().collect());
    // Round-trip through a string rather than serde_json::from_value(val) directly: structs
    // combining #[serde(flatten)] with an #[serde(untagged)] field (OnnxEmbedderOptions,
    // CrossEncoderOptions) intermittently fail with "unknown field" through Value's Deserializer
    // impl, which doesn't reliably support the buffering flatten needs — a known serde_json
    // limitation. Deserializing from a string goes through the streaming Deserializer, which
    // does support it correctly.
    let text = serde_json::to_string(&val)
        .map_err(|e| anyhow!("{}: invalid options: {e}", spec.package))?;
    serde_json::from_str(&text).map_err(|e| anyhow!("{}: invalid options: {e}", spec.package))
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

#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
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

#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
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
        if q_dest.exists() || hf_download(model_id, "onnx/model_quantized.onnx", &q_dest).is_ok() {
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

#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
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
#[serde(rename_all = "camelCase")]
struct OnnxEmbedderOptions {
    #[serde(flatten)]
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

#[cfg(test)]
mod onnx_embedder_options_tests {
    use super::*;

    #[test]
    fn parses_flattened_source_alongside_named_fields() {
        let mut options = std::collections::HashMap::new();
        options.insert(
            "model".to_string(),
            serde_json::json!("Xenova/all-MiniLM-L6-v2"),
        );
        options.insert(
            "cacheDir".to_string(),
            serde_json::json!(".virage/model-cache"),
        );
        options.insert("dimensions".to_string(), serde_json::json!(384));
        let spec = PluginRef {
            package: "@vivantel/virage-embedder-onnx".to_string(),
            options,
        };

        let opts: OnnxEmbedderOptions = parse_options(&spec).unwrap();
        assert_eq!(opts.dimensions, 384);
        match opts.source {
            OnnxModelSource::HuggingFace {
                model, cache_dir, ..
            } => {
                assert_eq!(model, "Xenova/all-MiniLM-L6-v2");
                assert_eq!(cache_dir.as_deref(), Some(".virage/model-cache"));
            }
            _ => panic!("expected HuggingFace variant"),
        }
    }
}

fn default_true() -> bool {
    true
}

// ── Cross-encoder reranker options ────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CrossEncoderOptions {
    #[serde(flatten)]
    source: OnnxModelSource,
    max_length: Option<usize>,
    /// Score activation: "none" (default), "sigmoid", or "softmax".
    activation: Option<String>,
    /// Index into the logits vector to use as the relevance score (default: 0).
    #[serde(default)]
    score_index: usize,
    /// Number of results to return after reranking. Accepted for schema
    /// compatibility; not yet consumed by the reranker itself.
    #[allow(dead_code)]
    top_k: Option<usize>,
}

// ── Vector store options ──────────────────────────────────────────────────────

// Used by both the store-lancedb arm and store-dylib's compiled-in fallback for it below — a
// binary compiled with store-dylib instead of store-lancedb still needs to parse the same
// "@vivantel/virage-store-lancedb" config shape, just to hand the fields to a loaded plugin
// instead of a statically-linked LanceDbStore.
#[cfg(any(feature = "store-lancedb", feature = "store-dylib"))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LanceDbOptions {
    #[serde(default = "default_lancedb_uri")]
    uri: String,
    #[serde(default = "default_lancedb_table")]
    table_name: String,
}

#[cfg(any(feature = "store-lancedb", feature = "store-dylib"))]
fn default_lancedb_uri() -> String {
    ".virage/lancedb".to_string()
}
#[cfg(any(feature = "store-lancedb", feature = "store-dylib"))]
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
    branch: Option<String>,
    /// Reserved for future remote clone support — schema accepted, errors at runtime if set.
    url: Option<String>,
    /// Reserved for future shallow clone depth — schema accepted, ignored until url is implemented.
    #[allow(dead_code)]
    depth: Option<u32>,
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
            #[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
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
            #[cfg(not(any(feature = "embedder-onnx", feature = "download-binaries")))]
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
#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
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

#[cfg(feature = "store-dylib")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DylibStoreOptions {
    /// Explicit path to the plugin `.so`/`.dylib`/`.dll`. Overrides the default `.virage/plugins/`
    /// lookup in [`resolve_dylib_plugin_path`].
    #[serde(default)]
    plugin_path: Option<String>,
    /// Which plugin binary to look for in `.virage/plugins/` when `pluginPath` isn't given —
    /// resolves to the real cdylib artifact name cargo produces for a `virage-plugin-<backend>`
    /// crate (e.g. `libvirage_plugin_lancedb.so` on Linux).
    #[serde(default = "default_dylib_backend")]
    backend: String,
    /// Everything else is forwarded verbatim as the plugin's own `config_json` — the host doesn't
    /// need to know a given backend's option shape, only the plugin does.
    #[serde(flatten)]
    config: serde_json::Map<String, serde_json::Value>,
}

#[cfg(feature = "store-dylib")]
fn default_dylib_backend() -> String {
    "lancedb".to_string()
}

/// Resolves the plugin `.so`/`.dylib`/`.dll` path per the same `.virage/` project-local
/// convention already used for `.virage/lancedb` (store-lancedb's default URI) and
/// `.virage/model-cache` (the ONNX embedder's HuggingFace cache dir): `.virage/plugins/`.
///
/// Priority: explicit `pluginPath` option > `VIRAGE_STORE_PLUGIN_PATH` env var > the default path
/// (`.virage/plugins/<platform DLL name for `backend`>`, via `std::env::consts::DLL_PREFIX`/
/// `DLL_SUFFIX` — not a hand-rolled per-OS branch).
#[cfg(feature = "store-dylib")]
fn resolve_dylib_plugin_path(explicit: Option<&str>, backend: &str) -> std::path::PathBuf {
    if let Some(p) = explicit {
        return std::path::PathBuf::from(p);
    }
    if let Ok(p) = std::env::var("VIRAGE_STORE_PLUGIN_PATH") {
        return std::path::PathBuf::from(p);
    }
    let filename = format!(
        "{}virage_plugin_{}{}",
        std::env::consts::DLL_PREFIX,
        backend,
        std::env::consts::DLL_SUFFIX
    );
    std::path::PathBuf::from(".virage")
        .join("plugins")
        .join(filename)
}

#[cfg(all(test, feature = "store-dylib"))]
mod dylib_store_options_tests {
    use super::*;

    #[test]
    fn explicit_plugin_path_takes_priority_over_default() {
        let resolved = resolve_dylib_plugin_path(Some("/custom/path.so"), "lancedb");
        assert_eq!(resolved, std::path::PathBuf::from("/custom/path.so"));
    }

    #[test]
    fn default_path_uses_virage_plugins_dir_and_platform_dll_name() {
        // This test assumes VIRAGE_STORE_PLUGIN_PATH isn't set in the test environment — nothing
        // else in this codebase sets it, but assert rather than silently produce a false pass if
        // that ever changes.
        assert!(
            std::env::var("VIRAGE_STORE_PLUGIN_PATH").is_err(),
            "test assumes VIRAGE_STORE_PLUGIN_PATH is unset in the test environment"
        );
        let resolved = resolve_dylib_plugin_path(None, "lancedb");
        let expected_filename = format!(
            "{}virage_plugin_lancedb{}",
            std::env::consts::DLL_PREFIX,
            std::env::consts::DLL_SUFFIX
        );
        assert_eq!(
            resolved,
            std::path::PathBuf::from(".virage")
                .join("plugins")
                .join(expected_filename)
        );
    }

    #[test]
    fn dylib_store_options_defaults_backend_to_lancedb_and_flattens_rest() {
        let mut options = std::collections::HashMap::new();
        options.insert("uri".to_string(), serde_json::json!(".virage/lancedb"));
        options.insert("tableName".to_string(), serde_json::json!("virage_chunks"));
        let spec = PluginRef {
            package: "@vivantel/virage-store-dylib".to_string(),
            options,
        };

        let opts: DylibStoreOptions = parse_options(&spec).unwrap();
        assert_eq!(opts.backend, "lancedb");
        assert!(opts.plugin_path.is_none());
        assert_eq!(
            opts.config.get("uri").and_then(|v| v.as_str()),
            Some(".virage/lancedb")
        );
    }

    #[test]
    fn dylib_store_options_accepts_explicit_plugin_path_and_backend() {
        let mut options = std::collections::HashMap::new();
        options.insert(
            "pluginPath".to_string(),
            serde_json::json!("/opt/plugins/custom.so"),
        );
        options.insert("backend".to_string(), serde_json::json!("qdrant"));
        let spec = PluginRef {
            package: "@vivantel/virage-store-dylib".to_string(),
            options,
        };

        let opts: DylibStoreOptions = parse_options(&spec).unwrap();
        assert_eq!(opts.plugin_path.as_deref(), Some("/opt/plugins/custom.so"));
        assert_eq!(opts.backend, "qdrant");
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
/// - `@vivantel/virage-store-dylib`     / `dylib`     → DylibStore (loads a `StoreVTable` plugin
///   from `.virage/plugins/` — local-dev/CI-iteration alternative to `store-lancedb`)
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
            // A binary built with store-dylib instead of store-lancedb (no static lancedb link)
            // still serves an existing "@vivantel/virage-store-lancedb" config transparently —
            // the config names a logical backend, not a link strategy, so no config.json or
            // wizard-generated default needs to change when a binary switches which one it was
            // compiled with.
            #[cfg(all(not(feature = "store-lancedb"), feature = "store-dylib"))]
            {
                let opts: LanceDbOptions = parse_options(spec)?;
                let plugin_path = resolve_dylib_plugin_path(None, "lancedb");
                let mut config = serde_json::Map::new();
                config.insert("uri".to_string(), serde_json::Value::from(opts.uri));
                config.insert(
                    "table_name".to_string(),
                    serde_json::Value::from(opts.table_name),
                );
                config.insert("dimensions".to_string(), serde_json::Value::from(dims));
                let config_json = serde_json::to_string(&config)?;
                Ok(Arc::new(crate::stores::dylib::DylibStore::open(
                    &plugin_path,
                    &config_json,
                )?))
            }
            #[cfg(not(any(feature = "store-lancedb", feature = "store-dylib")))]
            Err(anyhow!(
                "package {:?}: neither store-lancedb nor store-dylib compiled in",
                spec.package
            ))
        }
        p if p.contains("store-dylib") => {
            #[cfg(feature = "store-dylib")]
            {
                let opts: DylibStoreOptions = parse_options(spec)?;
                let plugin_path =
                    resolve_dylib_plugin_path(opts.plugin_path.as_deref(), &opts.backend);
                let mut config = opts.config;
                config.insert("dimensions".to_string(), serde_json::Value::from(dims));
                let config_json = serde_json::to_string(&config)?;
                Ok(Arc::new(crate::stores::dylib::DylibStore::open(
                    &plugin_path,
                    &config_json,
                )?))
            }
            #[cfg(not(feature = "store-dylib"))]
            Err(anyhow!("store-dylib feature not compiled in"))
        }
        other => Err(anyhow!("unknown vector store package {:?}", other)),
    }
}

// ─── Source provider resolution ───────────────────────────────────────────────

/// Signature for an out-of-tree source resolver registered via
/// [`register_source_fallback`].
type SourceFallback =
    dyn Fn(&PluginRef, &Path) -> anyhow::Result<Arc<dyn SourceProvider>> + Send + Sync;

static SOURCE_FALLBACK: std::sync::OnceLock<Box<SourceFallback>> = std::sync::OnceLock::new();

/// Register a fallback source resolver for packages this build's built-in
/// `resolve_source` doesn't recognize. A superset binary (e.g. an EE build) calls
/// this once at startup, before any config is resolved, to extend source
/// resolution without this crate depending on the superset's source crates. Only
/// the first call takes effect; later calls are silently ignored.
///
/// Mirrors [`register_chunker_fallback`] below — same `OnceLock`/first-writer-wins
/// mechanics. Kept synchronous like the chunker hook: providers with async
/// constructors (e.g. one that loads cloud SDK config) must defer that work to
/// first use rather than doing it in the fallback closure.
pub fn register_source_fallback(
    f: impl Fn(&PluginRef, &Path) -> anyhow::Result<Arc<dyn SourceProvider>> + Send + Sync + 'static,
) {
    let _ = SOURCE_FALLBACK.set(Box::new(f));
}

/// Instantiate a built-in `SourceProvider` from a `PluginRef` and fallback cwd.
///
/// Supported packages (or `builtin:` shorthands):
/// - `@vivantel/virage-source-git`     → GitSourceProvider
/// - `@vivantel/virage-source-localfs` → LocalFsSourceProvider
///
/// Packages not in this list fall through to a resolver registered via
/// [`register_source_fallback`], if any.
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
                if opts.url.is_some() {
                    anyhow::bail!(
                        "git source 'url' (remote clone) is not yet implemented — \
                         clone the repo locally and set 'root' to point to it"
                    );
                }
                let root = opts.root.as_deref().map(Path::new).unwrap_or(cwd);
                let provider =
                    crate::sources::git::GitSourceProvider::open_branch(root, "git", opts.branch)?;
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
        Some(p) => match SOURCE_FALLBACK.get() {
            Some(fallback) => fallback(p, cwd),
            None => Err(anyhow!("unknown source package {:?}", p.package)),
        },
    }
}

#[cfg(test)]
mod source_resolution_tests {
    use super::*;

    fn plugin_ref(package: &str) -> PluginRef {
        PluginRef {
            package: package.to_string(),
            options: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn fallback_is_consulted_for_unrecognized_packages() {
        // SOURCE_FALLBACK is a process-global OnceLock shared by every test in this
        // binary, so this closure must preserve the built-in "unknown source
        // package" error text for anything but its own probe package — otherwise it
        // would silently change the outcome of unknown_package_is_an_error depending
        // on test execution order.
        register_source_fallback(|spec, _cwd| {
            if spec.package == "@vivantel/virage-source-ee-fallback-probe" {
                Err(anyhow!("fallback reached for {:?}", spec.package))
            } else {
                Err(anyhow!("unknown source package {:?}", spec.package))
            }
        });
        let err = match resolve_source(
            Some(&plugin_ref("@vivantel/virage-source-ee-fallback-probe")),
            Path::new("."),
        ) {
            Err(e) => e.to_string(),
            Ok(_) => panic!("expected an error from the fallback probe"),
        };
        assert!(err.contains("fallback reached"), "got: {err}");
    }

    #[test]
    fn unknown_package_is_an_error() {
        // Relies on the probe closure registered above preserving this error text
        // for any package it doesn't recognize (see comment there).
        let err = match resolve_source(
            Some(&plugin_ref("@vivantel/virage-source-ce-unknown")),
            Path::new("."),
        ) {
            Err(e) => e.to_string(),
            Ok(_) => panic!("expected an error"),
        };
        assert!(err.contains("unknown source package"), "got: {err}");
    }
}

// ─── FileSet group resolution (ADR-043) ───────────────────────────────────────

/// Resolve every fileSet in `cfg` into a `FileSetGroup`: its source provider (named,
/// inline, or falling back to `providers.source`/auto-detect), its `SourceFilter`
/// (top-level `ignore` + the fileSet's own `include`/`ignore`), and its chunkers.
///
/// Sources are memoized by name (named) or by "no override" (default), so fileSets that
/// share a source reuse the same provider instance instead of e.g. re-opening the same
/// git repo once per fileSet. Inline source overrides are resolved fresh per fileSet.
///
/// If `cfg.file_sets` is empty (no fileSets configured), returns a single implicit group
/// scoped only by the top-level `ignore` list, over `providers.source`/auto-detect.
#[cfg(feature = "pipeline")]
pub fn resolve_file_set_groups(
    cfg: &super::VirageConfigJson,
    cwd: &Path,
) -> anyhow::Result<Vec<crate::pipeline::FileSetGroup>> {
    use crate::sources::SourceFilter;

    if cfg.file_sets.is_empty() {
        let source = resolve_source(cfg.providers.source.as_ref(), cwd)?;
        let filter = if cfg.ignore.is_empty() {
            None
        } else {
            Some(SourceFilter {
                include: None,
                ignore: cfg.ignore.clone(),
            })
        };
        return Ok(vec![crate::pipeline::FileSetGroup {
            source,
            filter,
            chunkers: Vec::new(),
            tags: Vec::new(),
        }]);
    }

    let mut named_cache: std::collections::HashMap<String, Arc<dyn SourceProvider>> =
        std::collections::HashMap::new();
    let mut default_source: Option<Arc<dyn SourceProvider>> = None;

    let mut groups = Vec::with_capacity(cfg.file_sets.len());
    for fs in &cfg.file_sets {
        let source = match &fs.source {
            None => match &default_source {
                Some(s) => s.clone(),
                None => {
                    let s = resolve_source(cfg.providers.source.as_ref(), cwd)?;
                    default_source = Some(s.clone());
                    s
                }
            },
            Some(SourceRef::Named(name)) => match named_cache.get(name) {
                Some(s) => s.clone(),
                None => {
                    let plugin = cfg.sources.get(name).ok_or_else(|| {
                        anyhow!(
                            "fileSet {:?} references unknown source {:?} (not in top-level \"sources\")",
                            fs.name,
                            name
                        )
                    })?;
                    let s = resolve_source(Some(plugin), cwd)?;
                    named_cache.insert(name.clone(), s.clone());
                    s
                }
            },
            Some(SourceRef::Inline(plugin)) => resolve_source(Some(plugin), cwd)?,
        };

        let mut ignore = cfg.ignore.clone();
        ignore.extend(fs.ignore.iter().cloned());
        let filter = Some(SourceFilter {
            include: if fs.include.is_empty() {
                None
            } else {
                Some(fs.include.clone())
            },
            ignore,
        });

        groups.push(crate::pipeline::FileSetGroup {
            source,
            filter,
            chunkers: resolve_chunkers(&fs.chunkers)?,
            tags: fs.tags.clone(),
        });
    }
    Ok(groups)
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

// ─── Chunker resolution ────────────────────────────────────────────────────────

/// Signature for an out-of-tree chunker resolver registered via
/// [`register_chunker_fallback`].
type ChunkerFallback =
    dyn Fn(&PluginRef) -> anyhow::Result<Arc<dyn crate::chunkers::FileChunker>> + Send + Sync;

static CHUNKER_FALLBACK: std::sync::OnceLock<Box<ChunkerFallback>> = std::sync::OnceLock::new();

/// Register a fallback chunker resolver for packages this build's built-in
/// `resolve_chunker` doesn't recognize. A superset binary (e.g. an EE build) calls
/// this once at startup, before any config is resolved, to extend chunker
/// resolution without this crate depending on the superset's chunker crates. Only
/// the first call takes effect; later calls are silently ignored.
pub fn register_chunker_fallback(
    f: impl Fn(&PluginRef) -> anyhow::Result<Arc<dyn crate::chunkers::FileChunker>>
        + Send
        + Sync
        + 'static,
) {
    let _ = CHUNKER_FALLBACK.set(Box::new(f));
}

/// Instantiate a built-in `FileChunker` from a single `PluginRef`.
///
/// Supported packages (or `builtin:` shorthands):
/// - `@vivantel/virage-chunker-ce-pdf`   / `pdf`          → PdfChunker
/// - `@vivantel/virage-chunker-ce-docx`  / `docx`, `word`  → DocxChunker
/// - `@vivantel/virage-chunker-ce-md`    / `md`, `markdown` → MdChunker
/// - `@vivantel/virage-chunker-ce-latex` / `latex`, `tex`   → LatexChunker
/// - `@vivantel/virage-chunker-ce-lang`  / `lang`, `code`   → LangChunker
///
/// Packages not in this list fall through to a resolver registered via
/// [`register_chunker_fallback`], if any.
fn resolve_chunker(spec: &PluginRef) -> anyhow::Result<Arc<dyn crate::chunkers::FileChunker>> {
    match spec.package.as_str() {
        p if p.contains("chunker-ce-pdf") => {
            #[cfg(feature = "chunker-pdf")]
            {
                Ok(Arc::new(crate::chunkers::pdf::PdfChunker))
            }
            #[cfg(not(feature = "chunker-pdf"))]
            Err(anyhow!("chunker-pdf feature not compiled in"))
        }
        p if p.contains("chunker-ce-docx") => {
            #[cfg(feature = "chunker-docx")]
            {
                Ok(Arc::new(crate::chunkers::docx::DocxChunker))
            }
            #[cfg(not(feature = "chunker-docx"))]
            Err(anyhow!("chunker-docx feature not compiled in"))
        }
        p if p.contains("chunker-ce-md") => {
            #[cfg(feature = "chunker-md")]
            {
                Ok(Arc::new(crate::chunkers::md::MdChunker))
            }
            #[cfg(not(feature = "chunker-md"))]
            Err(anyhow!("chunker-md feature not compiled in"))
        }
        p if p.contains("chunker-ce-latex") => {
            #[cfg(feature = "chunker-latex")]
            {
                Ok(Arc::new(crate::chunkers::latex::LatexChunker))
            }
            #[cfg(not(feature = "chunker-latex"))]
            Err(anyhow!("chunker-latex feature not compiled in"))
        }
        p if p.contains("chunker-ce-lang") => {
            #[cfg(feature = "chunker-lang")]
            {
                Ok(Arc::new(crate::chunkers::lang::LangChunker))
            }
            #[cfg(not(feature = "chunker-lang"))]
            Err(anyhow!("chunker-lang feature not compiled in"))
        }
        other => match CHUNKER_FALLBACK.get() {
            Some(fallback) => fallback(spec),
            None => Err(anyhow!("unknown chunker package {:?}", other)),
        },
    }
}

/// Resolve every distinct chunker `PluginRef` referenced across all fileSets into
/// `FileChunker` instances. Callers match files to chunkers via `FileChunker::patterns()`
/// at dispatch time (see `pipeline::worker::process_item`) — this function only handles
/// package → instance resolution, deduplicated by package name so the same chunker isn't
/// constructed twice when multiple fileSets reference it.
pub fn resolve_chunkers(
    specs: &[PluginRef],
) -> anyhow::Result<Vec<Arc<dyn crate::chunkers::FileChunker>>> {
    let mut seen = std::collections::HashSet::new();
    let mut chunkers = Vec::new();
    for spec in specs {
        if seen.insert(spec.package.clone()) {
            chunkers.push(resolve_chunker(spec)?);
        }
    }
    Ok(chunkers)
}

#[cfg(test)]
mod chunker_resolution_tests {
    use super::*;

    fn plugin_ref(package: &str) -> PluginRef {
        PluginRef {
            package: package.to_string(),
            options: std::collections::HashMap::new(),
        }
    }

    #[test]
    #[cfg(feature = "chunker-pdf")]
    fn resolves_pdf_chunker() {
        let c = resolve_chunker(&plugin_ref("@vivantel/virage-chunker-ce-pdf")).unwrap();
        assert_eq!(c.name(), "pdf");
        assert_eq!(c.patterns(), &["*.pdf"]);
    }

    #[test]
    #[cfg(feature = "chunker-md")]
    fn resolves_md_chunker() {
        let c = resolve_chunker(&plugin_ref("@vivantel/virage-chunker-ce-md")).unwrap();
        assert_eq!(c.name(), "md");
    }

    #[test]
    fn fallback_is_consulted_for_unrecognized_packages() {
        // CHUNKER_FALLBACK is a process-global OnceLock shared by every test in this
        // binary, so this closure must preserve the built-in "unknown chunker
        // package" error text for anything but its own probe package — otherwise it
        // would silently change the outcome of unrecognized_package_is_an_error
        // depending on test execution order.
        register_chunker_fallback(|spec| {
            if spec.package == "@vivantel/virage-chunker-ee-fallback-probe" {
                Err(anyhow!("fallback reached for {:?}", spec.package))
            } else {
                Err(anyhow!("unknown chunker package {:?}", spec.package))
            }
        });
        let err = match resolve_chunker(&plugin_ref("@vivantel/virage-chunker-ee-fallback-probe")) {
            Err(e) => e.to_string(),
            Ok(_) => panic!("expected an error from the fallback probe"),
        };
        assert!(err.contains("fallback reached"), "got: {err}");
    }

    #[test]
    fn unknown_package_is_an_error() {
        // Not .unwrap_err(): that requires the Ok type (Arc<dyn FileChunker>) to impl
        // Debug for its panic message, which it doesn't.
        let err = match resolve_chunker(&plugin_ref("@vivantel/virage-chunker-ce-unknown")) {
            Err(e) => e.to_string(),
            Ok(_) => panic!("expected an error for an unknown chunker package"),
        };
        assert!(err.contains("unknown chunker package"), "got: {err}");
    }

    #[test]
    #[cfg(feature = "chunker-pdf")]
    fn resolve_chunkers_dedupes_by_package() {
        let specs = vec![
            plugin_ref("@vivantel/virage-chunker-ce-pdf"),
            plugin_ref("@vivantel/virage-chunker-ce-pdf"),
        ];
        let chunkers = resolve_chunkers(&specs).unwrap();
        assert_eq!(
            chunkers.len(),
            1,
            "same package referenced twice should dedupe to 1"
        );
    }
}
