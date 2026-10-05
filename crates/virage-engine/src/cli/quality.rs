use std::path::Path;

use crate::history::benchmark::ToBenchmarkPoints;
use crate::output::{Out, OutputFormat};

use super::util::{ci_exit_codes, resolve_config_path, spinner};

#[derive(clap::Args)]
pub struct QualityArgs {
    #[command(subcommand)]
    pub command: Option<QualityCommand>,
}

#[derive(clap::Subcommand)]
pub enum QualityCommand {
    /// Run the 26-metric pipeline-health model.
    Run(QualityRunArgs),
    /// Show historical quality run trends from the shared history store.
    History(QualityHistoryArgs),
}

#[derive(clap::Args)]
pub struct QualityRunArgs {
    /// Exit 3 if any must-pass metric fails its gate threshold. Without this flag, failures
    /// print as warnings and the command exits 0.
    #[arg(long)]
    pub ci: bool,
    /// Path to virage.db.
    #[arg(long, default_value = "")]
    pub db: String,
}

#[derive(clap::Args)]
pub struct QualityHistoryArgs {
    /// Number of most recent runs to show.
    #[arg(long, default_value_t = 10)]
    pub limit: usize,
}

pub async fn cmd_quality(
    args: QualityArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    match args.command {
        None => {
            cmd_quality_run(
                QualityRunArgs {
                    ci: false,
                    db: String::new(),
                },
                verbose,
                format,
                config,
            )
            .await
        }
        Some(QualityCommand::Run(run_args)) => {
            cmd_quality_run(run_args, verbose, format, config).await
        }
        Some(QualityCommand::History(history_args)) => {
            cmd_quality_history(history_args, verbose, format)
        }
    }
}

pub async fn cmd_quality_run(
    args: QualityRunArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    let cfg = crate::config::load_config(&config_path)?;
    let dims = super::util::embedder_dims(&cfg);

    let pb = spinner("Running quality assessment...");
    let report = crate::quality::runner::run_quality_assessment(
        &cfg,
        dims,
        &crate::quality::runner::QualityRunOptions {
            config_file: config_path.clone(),
            sample_size: 100,
            top_k: 10,
        },
    )
    .await?;
    pb.finish_and_clear();

    let history_dir = Path::new(crate::history::DEFAULT_HISTORY_DIR);
    let history_id = crate::history::save(history_dir, "quality", &report.timestamp, &report)?;
    crate::history::benchmark::upsert(history_dir, &report.to_benchmark_points())?;
    crate::quality::badge::write(history_dir, report.overall_score, report.status)?;
    out.dim(&format!("Saved to history: {history_id}"));

    match format {
        OutputFormat::Json => out.data_json(&serde_json::to_value(&report)?),
        OutputFormat::Markdown => out.data_line(&crate::quality::report::format_markdown(&report)),
        _ => println!("{}", crate::quality::report::format_console(&report)),
    }

    if args.ci && !report.status.is_pass() {
        std::process::exit(ci_exit_codes::QUALITY_GATE_FAILURE);
    }
    Ok(())
}

pub fn cmd_quality_history(
    args: QualityHistoryArgs,
    verbose: u8,
    format: OutputFormat,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let history_dir = Path::new(crate::history::DEFAULT_HISTORY_DIR);
    let entries: Vec<(String, crate::quality::QualityReport)> =
        crate::history::list_ids(history_dir, "quality")
            .into_iter()
            .take(args.limit)
            .filter_map(|id| crate::history::load(history_dir, "quality", &id).map(|r| (id, r)))
            .collect();

    match format {
        OutputFormat::Json => out.data_json(&serde_json::json!(entries
            .iter()
            .map(|(id, r)| serde_json::json!({
                "id": id,
                "timestamp": r.timestamp,
                "overallScore": r.overall_score,
                "status": r.status,
                "sampleSize": r.sample_size,
                "durationMs": r.duration_ms,
            }))
            .collect::<Vec<_>>())),
        _ => {
            if entries.is_empty() {
                println!("No quality history recorded yet — run `virage quality run` first.");
            } else {
                println!(
                    "{:<22}  {:>7}  {:<6}  {:>10}",
                    "Timestamp", "Score", "Status", "Duration"
                );
                for (_, r) in &entries {
                    println!(
                        "{:<22}  {:>6.1}%  {:<6}  {:>9}ms",
                        r.timestamp,
                        r.overall_score * 100.0,
                        r.status,
                        r.duration_ms
                    );
                }
            }
        }
    }
    Ok(())
}
