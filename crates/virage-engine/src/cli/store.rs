use crate::config::load_config;
use crate::config::resolve::resolve_store;
use crate::output::{Out, OutputFormat};
use crate::stores::SearchOptions;

use super::util::{embedder_dims, resolve_config_path, spinner};
use super::ConfigPathArg;

#[derive(clap::Args)]
pub struct StoreArgs {
    #[command(subcommand)]
    pub command: StoreCommand,
}

#[derive(clap::Subcommand)]
pub enum StoreCommand {
    /// Print vector store statistics.
    Stats(ConfigPathArg),
    /// Run a query-performance benchmark.
    Perf(ConfigPathArg),
}

pub async fn cmd_store_stats(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    let cfg = load_config(&config_path)?;
    let dims = embedder_dims(&cfg);

    let pb = spinner("Connecting to vector store...");
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;
    pb.finish_and_clear();

    let state = store.current_state().await?;
    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "package": cfg.providers.vector_store.package,
            "indexedFiles": state.len(),
            "dimensions": dims,
        }));
    } else {
        out.section("Store Stats");
        out.info(&format!(
            "Package       : {}",
            cfg.providers.vector_store.package
        ));
        out.info(&format!("Indexed files : {}", state.len()));
        out.info(&format!("Dimensions    : {dims}"));
    }
    Ok(())
}

pub async fn cmd_store_perf(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    let cfg = load_config(&config_path)?;
    let dims = embedder_dims(&cfg);

    let pb = spinner("Connecting to vector store...");
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;
    pb.finish_and_clear();

    const N: usize = 50;
    out.section("Store Performance Benchmark");
    out.dim(&format!(
        "Running {N} queries against {} (dims={dims})...",
        cfg.providers.vector_store.package
    ));

    // Pseudo-random vectors via LCG — tests store latency independent of embedder.
    let mut durations_ms = Vec::with_capacity(N);
    let mut seed: u64 = 0xDEAD_BEEF;
    for _ in 0..N {
        let vec: Vec<f32> = (0..dims)
            .map(|_| {
                seed = seed
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                (seed >> 33) as f32 / u32::MAX as f32 * 2.0 - 1.0
            })
            .collect();

        let opts = SearchOptions {
            filter: None,
            tag_filter: None,
            hybrid: false,
            hybrid_alpha: 0.6,
            query_text: None,
        };

        let t0 = std::time::Instant::now();
        let _ = store.search(&vec, 5, opts).await;
        durations_ms.push(t0.elapsed().as_secs_f64() * 1000.0);
    }

    durations_ms.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let p50 = durations_ms[N / 2];
    let p95 = durations_ms[(N as f64 * 0.95) as usize];
    let p99 = durations_ms[(N as f64 * 0.99) as usize];
    let total: f64 = durations_ms.iter().sum();
    let qps = N as f64 / (total / 1000.0);

    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "queries": N,
            "p50Ms": p50,
            "p95Ms": p95,
            "p99Ms": p99,
            "qps": qps,
        }));
    } else {
        out.info(&format!("  p50 : {p50:.1}ms"));
        out.info(&format!("  p95 : {p95:.1}ms"));
        out.info(&format!("  p99 : {p99:.1}ms"));
        out.info(&format!("  QPS : {qps:.0}  (sequential, {N} queries)"));
    }
    Ok(())
}
