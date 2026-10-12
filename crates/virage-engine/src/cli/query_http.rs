//! `virage query-http` — the warm query endpoint (retrieval contract v0, part c).
//!
//! Binds a loopback port, resolves the embedder/store/reranker once (the same engine resolution
//! `query-serve` uses, so the embedder stays warm), writes the discovery file when ready, serves
//! `POST /v0/query` and `GET /v0/health`, and exits after an idle timeout or on SIGTERM/SIGINT,
//! removing the discovery file. It is not owned by a parent process and never starts or stops
//! anything else. The stdio `query-serve` is unchanged.

use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use crate::config::{load_config, VirageConfigJson};
use crate::retrieval::discovery::{generate_token, live_endpoint, DiscoveryFile};
use crate::retrieval::endpoint::{
    serve, BackendError, Hit, QueryBackend, QueryParams, ServerConfig,
};
use crate::retrieval::policy::{enforce_for_query, PolicyError};
use crate::retrieval::tool_version;

use super::query::{resolve_engine, run_search, QueryArgs, ResolvedEngine};
use super::util::resolve_config_path;

#[derive(clap::Args)]
pub struct QueryHttpArgs {
    /// Path to the config file (default: discovered like other commands).
    #[arg(long, default_value = "")]
    pub config: String,
    /// End the endpoint after this many seconds without a request (minimum 60).
    #[arg(long, default_value_t = 600)]
    pub idle_timeout: u64,
}

/// The real backend: `run_search` against a warm engine, with the index policy applied inside it.
struct EngineBackend {
    cfg: VirageConfigJson,
    engine: OnceLock<ResolvedEngine>,
}

impl EngineBackend {
    async fn warm(&self, config_path: &Path) -> anyhow::Result<()> {
        let engine = resolve_engine(&self.cfg, config_path).await?;
        let _ = self.engine.set(engine);
        Ok(())
    }
}

fn row_to_hit(row: &serde_json::Value) -> Hit {
    let meta_u64 = |key: &str| row["metadata"].get(key).and_then(|v| v.as_u64());
    Hit {
        source_file: row["sourceFile"].as_str().map(str::to_string),
        text: row["denseText"].as_str().unwrap_or_default().to_string(),
        similarity: row["similarity"].as_f64().unwrap_or(0.0) as f32,
        line_start: meta_u64("lineStart"),
        line_end: meta_u64("lineEnd"),
    }
}

#[async_trait::async_trait]
impl QueryBackend for EngineBackend {
    fn is_ready(&self) -> bool {
        self.engine.get().is_some()
    }

    async fn query(&self, params: &QueryParams) -> Result<Vec<Hit>, BackendError> {
        let engine = self.engine.get().ok_or(BackendError::NotReady)?;
        let args: QueryArgs = serde_json::from_value(serde_json::json!({
            "query": params.query,
            "top_k": params.max_chunks,
            "min_similarity": params.min_similarity,
        }))
        .map_err(|_| BackendError::Failed)?;
        match run_search(&args, &self.cfg, engine).await {
            Ok(rows) => Ok(rows.iter().map(row_to_hit).collect()),
            Err(e) => match e.downcast_ref::<PolicyError>() {
                // The message names a path or an embedder kind, never content.
                Some(policy) => Err(BackendError::Refused(policy.to_string())),
                None => {
                    // Not logged with detail: a store or embedder error may quote content.
                    eprintln!("[virage] query-http: a query failed");
                    Err(BackendError::Failed)
                }
            },
        }
    }
}

/// Resolves on SIGINT, or on SIGTERM where it exists.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = signal(SignalKind::terminate()).ok();
        let terminated = async {
            match term.as_mut() {
                Some(s) => {
                    s.recv().await;
                }
                None => std::future::pending::<()>().await,
            }
        };
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminated => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

pub async fn cmd_query_http(args: &QueryHttpArgs) -> anyhow::Result<()> {
    let project_dir = std::env::current_dir()?;
    let config_path = resolve_config_path(&args.config)?;
    let cfg = load_config(&config_path)?;

    // Governance first: refuse before anything is bound or written.
    enforce_for_query(&project_dir, Path::new(&config_path), &cfg)?;

    // On demand and idempotent: a live endpoint for this project is reused, not duplicated.
    if let Some(address) = live_endpoint(&project_dir) {
        eprintln!("[virage] query endpoint already running at {address}");
        return Ok(());
    }

    let token = generate_token()?;
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
    let address = listener.local_addr()?.to_string();
    let idle = Duration::from_secs(args.idle_timeout.max(60));

    let backend = Arc::new(EngineBackend {
        cfg,
        engine: OnceLock::new(),
    });
    let mut server = tokio::spawn(serve(
        listener,
        ServerConfig {
            token: token.clone(),
            idle_timeout: idle,
            project_root: project_dir.clone(),
        },
        backend.clone(),
        shutdown_signal(),
    ));

    eprintln!("[virage] query endpoint: resolving engine...");
    let warm = backend.warm(Path::new(&config_path));
    tokio::pin!(warm);
    let guard;
    tokio::select! {
        warmed = &mut warm => {
            if let Err(e) = warmed {
                server.abort();
                return Err(e);
            }
            guard = DiscoveryFile::write(&project_dir, &address, &token, tool_version())?;
            eprintln!(
                "[virage] query endpoint ready at {address} (idle timeout {}s)",
                idle.as_secs()
            );
        }
        // Stopped by a signal while still warming up: nothing was written.
        ended = &mut server => {
            return ended?.map_err(Into::into);
        }
    }

    // Serve until the idle timeout or a signal, then remove the discovery file.
    let ended = server.await;
    drop(guard);
    eprintln!("[virage] query endpoint stopped");
    ended??;
    Ok(())
}
