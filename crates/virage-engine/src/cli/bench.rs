use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::config::load_config;
use crate::config::resolve::{resolve_chunkers, resolve_embedder, resolve_source, resolve_store};
use crate::history::benchmark::ToBenchmarkPoints;
use crate::output::{Out, OutputFormat};
use crate::pipeline::{coordinator::run_pipeline, PipelineConfig};

use super::util::{ci_exit_codes, embedder_dims, resolve_config_path, spinner};

#[derive(clap::Args)]
pub struct BenchArgs {
    #[command(subcommand)]
    pub command: BenchCommand,
}

#[derive(clap::Subcommand)]
pub enum BenchCommand {
    /// Measure indexing throughput: wall-clock, docs/sec, chunks/sec, tokens/sec.
    Index(BenchIndexArgs),
}

#[derive(clap::Args)]
pub struct BenchIndexArgs {
    /// Corpus path to index for benchmarking.
    #[arg(long)]
    pub path: PathBuf,
    /// Exit 5 on a regression vs. the shared history store's last recorded run. Without this
    /// flag, a regression prints as a warning and the command exits 0.
    #[arg(long)]
    pub ci: bool,
}

pub async fn cmd_bench(
    args: BenchArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    match args.command {
        BenchCommand::Index(index_args) => {
            cmd_bench_index(index_args, verbose, format, config).await
        }
    }
}

pub async fn cmd_bench_index(
    args: BenchIndexArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    let cfg = load_config(&config_path)?;
    let dims = embedder_dims(&cfg);

    let embedder = resolve_embedder(&cfg.providers.embedder)?;
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    let source = resolve_source(cfg.providers.source.as_ref(), &args.path)?;
    let chunker_specs: Vec<_> = cfg
        .file_sets
        .iter()
        .flat_map(|fs| fs.chunkers.iter().cloned())
        .collect();
    let chunkers = resolve_chunkers(&chunker_specs)?;

    let pipeline_cfg = PipelineConfig {
        workers: cfg
            .pipeline
            .as_ref()
            .and_then(|p| p.concurrency)
            .unwrap_or_else(|| {
                std::thread::available_parallelism()
                    .map(|n| n.get())
                    .unwrap_or(4)
            }),
        upload_batch_size: cfg
            .pipeline
            .as_ref()
            .and_then(|p| p.min_upload_batch_size)
            .unwrap_or(64),
        max_tokens: 512,
        label_rules: cfg
            .label_rules
            .iter()
            .map(|r| crate::pipeline::LabelRule {
                pattern: r.pattern.clone(),
                add: r.add.clone(),
            })
            .collect(),
        ..Default::default()
    };

    let pb = spinner(&format!("Benchmarking index of {}...", args.path.display()));
    let t0 = std::time::Instant::now();
    // Always a full run (no known_revisions) — a bench run must measure a comparable, complete
    // indexing workload every time, not whatever happens to be stale vs. the last `virage index`.
    let stats = run_pipeline(
        &pipeline_cfg,
        source,
        chunkers,
        embedder,
        store,
        HashMap::new(),
    )
    .await?;
    let duration_ms = t0.elapsed().as_millis();
    pb.finish_and_clear();

    let corpus_path = args.path.display().to_string();
    let result = crate::bench::BenchResult::new(
        corpus_path.clone(),
        stats.files_processed,
        stats.chunks_upserted,
        stats.tokens_processed,
        duration_ms,
    );

    let history_dir = Path::new(crate::history::DEFAULT_HISTORY_DIR);
    let previous =
        crate::history::load_latest_where::<crate::bench::BenchResult>(history_dir, "bench", |r| {
            r.corpus_path == corpus_path
        });
    let gate_threshold = cfg
        .bench
        .as_ref()
        .map(|b| b.max_regression_pct())
        .unwrap_or(crate::config::BenchThresholds::DEFAULT_MAX_REGRESSION_PCT);
    let cmp = crate::bench::compare(result.clone(), previous, gate_threshold);
    let history_id = crate::history::save(history_dir, "bench", &result.timestamp, &result)?;
    crate::history::benchmark::upsert(history_dir, &result.to_benchmark_points())?;
    out.dim(&format!("Saved to history: {history_id}"));

    match format {
        OutputFormat::Json => out.data_json(&serde_json::to_value(&cmp)?),
        OutputFormat::Markdown => out.data_line(&crate::bench::report::format_markdown(&cmp)),
        _ => println!("{}", crate::bench::report::format_console(&cmp)),
    }

    if args.ci && !cmp.gate_passed {
        std::process::exit(ci_exit_codes::BENCH_GATE_FAILURE);
    }
    Ok(())
}
