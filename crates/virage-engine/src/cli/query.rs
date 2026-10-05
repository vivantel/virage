use std::sync::Arc;

use crate::config::load_config;
#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
use crate::config::resolve::resolve_reranker;
use crate::config::resolve::{resolve_embedder, resolve_store};
use crate::config::VirageConfigJson;
use crate::embedders::Embedder;
use crate::output::{Out, OutputFormat};
use crate::stores::{SearchOptions, VectorStore};

use super::util::{embedder_dims, open_or_init_db, resolve_config_path, resolve_db_path, spinner};

// Deserialize is for query-serve's daemon protocol (see query_serve.rs) — the same
// struct is used both as clap CLI args and as the JSON request shape read from stdin,
// so field defaults are declared once and stay identical between the two callers.
#[derive(clap::Args, serde::Deserialize)]
pub struct QueryArgs {
    /// The query text.
    pub query: String,
    /// Number of results to return.
    #[arg(long, default_value_t = 5)]
    #[serde(default = "default_top_k")]
    pub top_k: usize,
    /// [deprecated] Use --format json instead.
    #[arg(long, hide = true)]
    #[serde(default)]
    pub json: bool,
    /// Enable hybrid (dense + sparse) search.
    #[arg(long)]
    #[serde(default)]
    pub hybrid: bool,
    /// Hybrid search alpha weight (0.0 = sparse only, 1.0 = dense only).
    #[arg(long)]
    #[serde(default)]
    pub hybrid_alpha: Option<f32>,
    /// Apply cross-encoder reranker after retrieval.
    #[arg(long)]
    #[serde(default)]
    pub rerank: bool,
    /// Filter results to a specific branch.
    #[arg(long)]
    #[serde(default)]
    pub branch: Option<String>,
    /// Minimum similarity threshold (0–1).
    #[arg(long)]
    #[serde(default)]
    pub min_similarity: Option<f32>,
    /// Skip this many results from the top of the ranked list (for pagination).
    #[arg(long, default_value_t = 0)]
    #[serde(default)]
    pub offset: usize,
}

fn default_top_k() -> usize {
    5
}

/// An embedder + vector store (+ optional reranker) resolved once and reused across
/// repeated searches — the expensive part (embedder cold start) happens exactly once
/// here, not per query. Built by [`resolve_engine`], consumed by [`run_search`].
pub struct ResolvedEngine {
    pub embedder: Arc<std::sync::Mutex<dyn Embedder + Send>>,
    pub store: Arc<dyn VectorStore>,
    #[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
    pub reranker: Option<Arc<std::sync::Mutex<dyn crate::rerankers::Reranker + Send>>>,
}

/// Resolve the embedder, vector store, and (if configured) reranker for `cfg`.
///
/// The embedder and reranker are independent of each other (neither reads the
/// other's output during construction) so their cold-start cost — dominated by
/// ONNX Runtime session init + tokenizer load, ~30s for the embedder vs ~500ms
/// for the reranker — is paid concurrently via `spawn_blocking`, not sequentially.
pub async fn resolve_engine(cfg: &VirageConfigJson) -> anyhow::Result<ResolvedEngine> {
    let dims = embedder_dims(cfg);
    let embedder_spec = cfg.providers.embedder.clone();
    #[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
    let reranker_spec = cfg.providers.reranker.clone();

    let embedder_task = tokio::task::spawn_blocking(move || resolve_embedder(&embedder_spec));
    #[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
    let reranker_task = tokio::task::spawn_blocking(move || {
        reranker_spec.as_ref().map(resolve_reranker).transpose()
    });

    #[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
    let (embedder_res, reranker_res) = tokio::join!(embedder_task, reranker_task);
    #[cfg(not(any(feature = "embedder-onnx", feature = "download-binaries")))]
    let embedder_res = embedder_task.await;

    let embedder = embedder_res.map_err(|e| anyhow::anyhow!("embedder task panicked: {e}"))??;
    #[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
    let reranker = reranker_res.map_err(|e| anyhow::anyhow!("reranker task panicked: {e}"))??;

    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;

    Ok(ResolvedEngine {
        embedder,
        store,
        #[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
        reranker,
    })
}

/// Run one search against an already-resolved engine, returning the same JSON row
/// shape `virage query --format json` has always produced (rank/similarity/sourceFile/
/// denseText/metadata) — callers appending pagination must slice `offset`/`top_k`
/// themselves via `args`, kept identical to the pre-daemon behavior for compatibility.
pub async fn run_search(
    args: &QueryArgs,
    cfg: &VirageConfigJson,
    engine: &ResolvedEngine,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let vec = engine
        .embedder
        .lock()
        .map_err(|_| anyhow::anyhow!("embedder lock poisoned"))?
        .embed_batch(&[args.query.as_str()])
        .map_err(|e| anyhow::anyhow!("Embed error: {e}"))?;

    let hybrid_alpha = args.hybrid_alpha.unwrap_or(0.6).clamp(0.0, 1.0);
    let opts = SearchOptions {
        filter: args.branch.as_deref().map(|b| {
            std::collections::HashMap::from([(
                "branch".to_string(),
                serde_json::Value::String(b.to_string()),
            )])
        }),
        tag_filter: None,
        hybrid: args.hybrid,
        hybrid_alpha,
        query_text: if args.hybrid {
            Some(args.query.clone())
        } else {
            None
        },
    };

    // ANN search returns the top `offset + top_k` so a page can be sliced out of it —
    // ANN backends don't make "skip S, take K" cheaper than "take S+K" internally, so
    // this isn't a compute-savings move, just how pagination composes with search().
    let search_size = args.offset.saturating_add(args.top_k);
    let mut results = engine.store.search(&vec, search_size, opts).await?;

    #[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
    if args.rerank || cfg.providers.reranker.is_some() {
        if let Some(reranker) = &engine.reranker {
            let passages: Vec<&str> = results.iter().map(|r| r.dense_text.as_str()).collect();
            let scores = reranker
                .lock()
                .map_err(|_| anyhow::anyhow!("reranker lock poisoned"))?
                .rerank(&args.query, &passages)
                .map_err(|e| anyhow::anyhow!("Reranker error: {e}"))?;
            let mut order: Vec<usize> = (0..results.len()).collect();
            order.sort_unstable_by(|&a, &b| {
                scores[b]
                    .partial_cmp(&scores[a])
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let mut slots: Vec<Option<_>> = results.into_iter().map(Some).collect();
            results = order
                .into_iter()
                .map(|i| slots[i].take().unwrap())
                .collect();
        }
    }
    #[cfg(not(any(feature = "embedder-onnx", feature = "download-binaries")))]
    let _ = cfg;

    if let Some(min_sim) = args.min_similarity {
        results.retain(|r| r.similarity >= min_sim);
    }

    if args.offset > 0 {
        results = results.into_iter().skip(args.offset).collect();
    }
    results.truncate(args.top_k);

    Ok(results
        .iter()
        .enumerate()
        .map(|(i, r)| {
            serde_json::json!({
                "rank": args.offset + i + 1,
                "similarity": r.similarity,
                "sourceFile": r.source_file,
                "denseText": r.dense_text,
                "metadata": r.metadata,
            })
        })
        .collect())
}

pub async fn cmd_query(
    args: QueryArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let t0 = std::time::Instant::now();
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    let cfg = load_config(&config_path)?;

    let pb = spinner("Loading embedder...");
    let engine = resolve_engine(&cfg).await?;
    pb.finish_and_clear();

    let json_rows = run_search(&args, &cfg, &engine).await?;

    let record_telemetry = |success: bool| {
        let db_path = resolve_db_path("");
        if let Ok(db) = open_or_init_db(&db_path) {
            let _ = db.record_cli_command("query", t0.elapsed().as_millis() as u64, success);
        }
    };

    // --json is a deprecated alias for --format json
    let use_json = format == OutputFormat::Json || args.json;

    if use_json {
        out.data_json(&serde_json::Value::Array(json_rows));
        record_telemetry(true);
        return Ok(());
    }

    if json_rows.is_empty() {
        out.warn("No results found.");
        record_telemetry(true);
        return Ok(());
    }

    if format == OutputFormat::Quiet {
        for r in &json_rows {
            let sim = r["similarity"].as_f64().unwrap_or(0.0);
            let src = r["sourceFile"].as_str().unwrap_or("unknown");
            println!("{sim:.2}  {src}");
        }
        record_telemetry(true);
        return Ok(());
    }

    use console::style;
    out.info(&format!(
        "\nTop {} result(s) for: \"{}\"\n",
        json_rows.len(),
        args.query
    ));
    for (i, r) in json_rows.iter().enumerate() {
        let dense_text = r["denseText"].as_str().unwrap_or("");
        let snippet = if dense_text.len() > 400 {
            format!("{}…", &dense_text[..400])
        } else {
            dense_text.to_string()
        };
        let src = r["sourceFile"].as_str().unwrap_or("unknown");
        let sim = r["similarity"].as_f64().unwrap_or(0.0);
        println!(
            "{}  {}  {}",
            style(format!("{:2}.", i + 1)).dim(),
            style(format!("{:.1}%", sim * 100.0)).cyan(),
            style(src).dim()
        );
        println!("   {snippet}");
        println!("{}", style("─".repeat(60)).dim());
    }
    record_telemetry(true);
    Ok(())
}
