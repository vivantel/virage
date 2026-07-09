use std::path::Path;
use std::sync::Arc;

use anyhow::anyhow;

use super::PluginRef;
use crate::embedders::Embedder;
use crate::sources::SourceProvider;
use crate::stores::VectorStore;

// ─── Embedder resolution ──────────────────────────────────────────────────────

/// Instantiate a built-in `Embedder` from a `PluginRef`.
///
/// Supported packages:
/// - `@vivantel/virage-embedder-onnx` → `OnnxEmbedder`
pub fn resolve_embedder(
    spec: &PluginRef,
) -> anyhow::Result<Arc<std::sync::Mutex<dyn Embedder + Send>>> {
    match spec.package.as_str() {
        p if p.contains("embedder-onnx") || p.contains("embedder-fastembed") => {
            #[cfg(feature = "embedder-onnx")]
            {
                let model_path = spec.str_req("modelPath")?;
                let tokenizer_path = spec.str_req("tokenizerPath")?;
                let dims = spec.usize_opt("dimensions").unwrap_or(384);
                let pooling = spec.str_opt("pooling");
                let emb = crate::embedders::onnx::OnnxEmbedder::new(
                    model_path,
                    tokenizer_path,
                    dims,
                    spec.usize_opt("maxLength"),
                    pooling,
                    spec.bool_opt("normalize"),
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

// ─── Vector store resolution ──────────────────────────────────────────────────

/// Instantiate a built-in `VectorStore` from a `PluginRef` and embedding dims.
///
/// Supported packages:
/// - `@vivantel/virage-store-qdrant`    → `QdrantStore`
/// - `@vivantel/virage-store-postgres`  → `PostgresStore`
/// - `@vivantel/virage-store-chromadb`  → `ChromaDbStore`
/// - `@vivantel/virage-store-lancedb`   → `LanceDbStore`
pub fn resolve_store(spec: &PluginRef, dims: usize) -> anyhow::Result<Arc<dyn VectorStore>> {
    match spec.package.as_str() {
        p if p.contains("store-qdrant") => {
            #[cfg(feature = "store-qdrant")]
            {
                let url = spec.str_opt("url").unwrap_or("http://localhost:6334");
                let col = spec.str_opt("collection").unwrap_or("virage");
                Ok(Arc::new(crate::stores::qdrant::QdrantStore::new(
                    url, col, dims,
                )))
            }
            #[cfg(not(feature = "store-qdrant"))]
            Err(anyhow!("store-qdrant feature not compiled in"))
        }
        p if p.contains("store-postgres") || p.contains("store-pgvector") => {
            #[cfg(feature = "store-postgres")]
            {
                let cs = spec.str_req("connectionString")?;
                let table = spec.str_opt("table").unwrap_or("virage_chunks");
                Ok(Arc::new(crate::stores::postgres::PostgresStore::new(
                    cs, table, dims,
                )))
            }
            #[cfg(not(feature = "store-postgres"))]
            Err(anyhow!("store-postgres feature not compiled in"))
        }
        p if p.contains("store-chromadb") => {
            #[cfg(feature = "store-chromadb")]
            {
                let base_url = spec.str_opt("baseUrl").unwrap_or("http://localhost:8000");
                let col = spec.str_opt("collectionName").unwrap_or("virage");
                Ok(Arc::new(crate::stores::chromadb::ChromaDbStore::new(
                    base_url, col,
                )))
            }
            #[cfg(not(feature = "store-chromadb"))]
            Err(anyhow!("store-chromadb feature not compiled in"))
        }
        p if p.contains("store-lancedb") => {
            #[cfg(feature = "store-lancedb")]
            {
                let uri = spec.str_opt("uri").unwrap_or(".virage/lancedb");
                let table = spec.str_opt("tableName").unwrap_or("virage_chunks");
                Ok(Arc::new(crate::stores::lancedb::LanceDbStore::new(
                    uri, table, dims,
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
/// Supported packages:
/// - `@vivantel/virage-source-git`     → `GitSourceProvider`
/// - `@vivantel/virage-source-localfs` → `LocalFsSourceProvider`
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
                let root = p.str_opt("root").map(Path::new).unwrap_or(cwd);
                let provider = crate::sources::git::GitSourceProvider::open(root, "git")?;
                Ok(Arc::new(provider))
            }
            #[cfg(not(feature = "source-git"))]
            Err(anyhow!("source-git feature not compiled in"))
        }
        Some(p) if p.package.contains("source-localfs") => {
            #[cfg(feature = "source-localfs")]
            {
                let root = p.str_opt("root").map(Path::new).unwrap_or(cwd);
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
    // Try git first; fall back to localfs if not a git repo.
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
