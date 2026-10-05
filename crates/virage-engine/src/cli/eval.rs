use std::path::Path;

use crate::config::load_config;
use crate::config::resolve::resolve_embedder;
use crate::history::benchmark::ToBenchmarkPoints;
use crate::output::{Out, OutputFormat};

use super::util::{ci_exit_codes, resolve_config_path, spinner};

/// Rows fetched per RAGBench subset, matching the JS predecessor's default.
const EVAL_MAX_ROWS_PER_SUBSET: usize = 50;
/// Retrieval top-K, matching the JS predecessor's default.
const EVAL_TOP_K: usize = 10;

#[derive(clap::Args)]
pub struct EvalArgs {
    #[command(subcommand)]
    pub command: EvalCommand,
}

#[derive(clap::Subcommand)]
pub enum EvalCommand {
    /// Measure retrieval accuracy against a dataset.
    Run(EvalRunArgs),
    /// Compare two eval runs with bootstrap paired significance testing.
    Compare(EvalCompareArgs),
}

#[derive(clap::Args)]
pub struct EvalRunArgs {
    /// Dataset source. v1: `ragbench:<subset>` (12 galileo-ai/ragbench HuggingFace subsets).
    /// Custom-dataset paths are accepted but unimplemented until eval generate ships (post-v1).
    pub dataset: String,
    /// Exit 4 if any must-pass metric fails its gate threshold. Without this flag, failures
    /// print as warnings and the command exits 0.
    #[arg(long)]
    pub ci: bool,
    /// Path to virage.db.
    #[arg(long, default_value = "")]
    pub db: String,
}

#[derive(clap::Args)]
pub struct EvalCompareArgs {
    /// Baseline eval run: the literal `latest`, a history id printed by `eval run` ("Saved to
    /// history: <id>"), or the run's raw `timestamp` field.
    pub baseline: String,
    /// Candidate eval run: same reference forms as `baseline`.
    pub candidate: String,
    /// Exit 4 if the bootstrap significance test recommends "reject". Without this flag,
    /// a "reject" recommendation prints as a warning and the command exits 0.
    #[arg(long)]
    pub ci: bool,
}

/// Parse a v1 `eval run` dataset spec. Only `ragbench:<subset>` (or `ragbench:all` for every
/// subset) is supported — custom-corpus datasets are deferred past v1 (IR-038).
fn parse_ragbench_subsets(dataset: &str) -> anyhow::Result<Vec<String>> {
    let Some(spec) = dataset.strip_prefix("ragbench:") else {
        anyhow::bail!(
            "Unsupported dataset {dataset:?} — v1 only supports `ragbench:<subset>` \
             (custom-dataset paths are deferred past v1, see IR-038)"
        );
    };
    if spec == "all" {
        return Ok(crate::eval::ragbench::HF_RAGBENCH_SUBSETS
            .iter()
            .map(|s| s.to_string())
            .collect());
    }
    if !crate::eval::ragbench::HF_RAGBENCH_SUBSETS.contains(&spec) {
        anyhow::bail!(
            "Unknown ragbench subset {spec:?}. Valid subsets: {}",
            crate::eval::ragbench::HF_RAGBENCH_SUBSETS.join(", ")
        );
    }
    Ok(vec![spec.to_string()])
}

pub async fn cmd_eval(
    args: EvalArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    match args.command {
        EvalCommand::Run(run_args) => cmd_eval_run(run_args, verbose, format, config).await,
        EvalCommand::Compare(compare_args) => cmd_eval_compare(compare_args, verbose, format),
    }
}

pub async fn cmd_eval_run(
    args: EvalRunArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let subsets = parse_ragbench_subsets(&args.dataset)?;

    let config_path = resolve_config_path(config)?;
    let cfg = load_config(&config_path)?;
    let embedder = resolve_embedder(&cfg.providers.embedder)?;
    let gate_threshold = cfg
        .eval
        .as_ref()
        .map(|e| e.min_mrr())
        .unwrap_or(crate::config::EvalThresholds::DEFAULT_MIN_MRR);

    let pb = spinner(&format!("Running eval against {}...", args.dataset));
    let t0 = std::time::Instant::now();
    let subset_results = crate::eval::ragbench::run_subsets(
        embedder.as_ref(),
        &subsets,
        EVAL_MAX_ROWS_PER_SUBSET,
        EVAL_TOP_K,
    )
    .await?;
    pb.finish_and_clear();

    let report = crate::eval::build_report(
        args.dataset.clone(),
        subset_results,
        EVAL_TOP_K,
        gate_threshold,
        t0.elapsed().as_millis(),
    );

    let history_dir = Path::new(crate::history::DEFAULT_HISTORY_DIR);
    let history_id = crate::history::save(history_dir, "eval", &report.timestamp, &report)?;
    crate::history::benchmark::upsert(history_dir, &report.to_benchmark_points())?;
    out.dim(&format!("Saved to history: {history_id}"));

    match format {
        OutputFormat::Json => out.data_json(&serde_json::to_value(&report)?),
        OutputFormat::Markdown => out.data_line(&crate::eval::report::format_markdown(&report)),
        _ => println!("{}", crate::eval::report::format_console(&report)),
    }

    if args.ci && !report.gate_passed {
        std::process::exit(ci_exit_codes::EVAL_GATE_FAILURE);
    }
    Ok(())
}

/// Resolves an `eval compare` baseline/candidate history reference (`"latest"`, a history id,
/// or a raw timestamp — see `history::resolve_ref`) and extracts its flattened per-query RR
/// scores for the bootstrap significance test.
fn load_eval_report_ref(history_dir: &Path, reference: &str) -> anyhow::Result<Vec<f64>> {
    let report: crate::eval::EvalReport =
        crate::history::resolve_ref(history_dir, "eval", reference).ok_or_else(|| {
            anyhow::anyhow!(
                "No eval history entry found for {reference:?} — run `virage eval run` first, \
                 or pass \"latest\""
            )
        })?;
    Ok(report.all_per_query_rr())
}

pub fn cmd_eval_compare(
    args: EvalCompareArgs,
    verbose: u8,
    format: OutputFormat,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let history_dir = Path::new(crate::history::DEFAULT_HISTORY_DIR);
    let baseline = load_eval_report_ref(history_dir, &args.baseline)?;
    let candidate = load_eval_report_ref(history_dir, &args.candidate)?;

    let result = crate::eval::statistics::bootstrap_paired_test(
        &baseline,
        &candidate,
        crate::eval::statistics::DEFAULT_ITERATIONS,
        crate::eval::statistics::DEFAULT_SEED,
    )?;

    match format {
        OutputFormat::Json => out.data_json(&serde_json::to_value(&result)?),
        OutputFormat::Markdown => {
            out.data_line(&crate::eval::report::format_compare_markdown(&result))
        }
        _ => println!("{}", crate::eval::report::format_compare_console(&result)),
    }

    if args.ci && result.recommendation == crate::eval::statistics::Recommendation::Reject {
        std::process::exit(ci_exit_codes::EVAL_GATE_FAILURE);
    }
    Ok(())
}
