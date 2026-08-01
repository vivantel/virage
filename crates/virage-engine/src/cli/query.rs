use crate::config::load_config;
#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
use crate::config::resolve::resolve_reranker;
use crate::config::resolve::{resolve_embedder, resolve_store};
use crate::output::{Out, OutputFormat};
use crate::stores::SearchOptions;

use super::util::{embedder_dims, open_or_init_db, resolve_config_path, resolve_db_path, spinner};

#[derive(clap::Args)]
pub struct QueryArgs {
    /// The query text.
    pub query: String,
    /// Number of results to return.
    #[arg(long, default_value_t = 5)]
    pub top_k: usize,
    /// [deprecated] Use --format json instead.
    #[arg(long, hide = true)]
    pub json: bool,
    /// Enable hybrid (dense + sparse) search.
    #[arg(long)]
    pub hybrid: bool,
    /// Hybrid search alpha weight (0.0 = sparse only, 1.0 = dense only).
    #[arg(long)]
    pub hybrid_alpha: Option<f32>,
    /// Apply cross-encoder reranker after retrieval.
    #[arg(long)]
    pub rerank: bool,
    /// Filter results to a specific branch.
    #[arg(long)]
    pub branch: Option<String>,
    /// Minimum similarity threshold (0–1).
    #[arg(long)]
    pub min_similarity: Option<f32>,
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
    let dims = embedder_dims(&cfg);

    let pb = spinner("Loading embedder...");
    let embedder = resolve_embedder(&cfg.providers.embedder)?;
    pb.set_message("Connecting to vector store...");
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;

    pb.set_message("Embedding query...");
    let vec = embedder
        .lock()
        .map_err(|_| anyhow::anyhow!("embedder lock poisoned"))?
        .embed_batch(std::slice::from_ref(&args.query))
        .map_err(|e| anyhow::anyhow!("Embed error: {e}"))?;
    pb.finish_and_clear();

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

    let mut results = store.search(&vec, args.top_k, opts).await?;

    // Apply reranker: --rerank flag or configured reranker provider triggers reranking.
    #[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
    if args.rerank || cfg.providers.reranker.is_some() {
        if let Some(reranker_spec) = &cfg.providers.reranker {
            let reranker = resolve_reranker(reranker_spec)?;
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

    // Apply min-similarity filter (on original vector-similarity score).
    if let Some(min_sim) = args.min_similarity {
        results.retain(|r| r.similarity >= min_sim);
    }

    let record_telemetry = |success: bool| {
        let db_path = resolve_db_path("");
        if let Ok(db) = open_or_init_db(&db_path) {
            let _ = db.record_cli_command("query", t0.elapsed().as_millis() as u64, success);
        }
    };

    // --json is a deprecated alias for --format json
    let use_json = format == OutputFormat::Json || args.json;

    if use_json {
        let json: Vec<serde_json::Value> = results
            .iter()
            .enumerate()
            .map(|(i, r)| {
                serde_json::json!({
                    "rank": i + 1,
                    "similarity": r.similarity,
                    "sourceFile": r.source_file,
                    "denseText": r.dense_text,
                    "metadata": r.metadata,
                })
            })
            .collect();
        out.data_json(&serde_json::Value::Array(json));
        record_telemetry(true);
        return Ok(());
    }

    if results.is_empty() {
        out.warn("No results found.");
        record_telemetry(true);
        return Ok(());
    }

    if format == OutputFormat::Quiet {
        for r in &results {
            let src = r.source_file.as_deref().unwrap_or("unknown");
            println!("{:.2}  {src}", r.similarity);
        }
        record_telemetry(true);
        return Ok(());
    }

    use console::style;
    out.info(&format!(
        "\nTop {} result(s) for: \"{}\"\n",
        results.len(),
        args.query
    ));
    for (i, r) in results.iter().enumerate() {
        let snippet = if r.dense_text.len() > 400 {
            format!("{}…", &r.dense_text[..400])
        } else {
            r.dense_text.clone()
        };
        let src = r.source_file.as_deref().unwrap_or("unknown");
        println!(
            "{}  {}  {}",
            style(format!("{:2}.", i + 1)).dim(),
            style(format!("{:.1}%", r.similarity * 100.0)).cyan(),
            style(src).dim()
        );
        println!("   {snippet}");
        println!("{}", style("─".repeat(60)).dim());
    }
    record_telemetry(true);
    Ok(())
}
