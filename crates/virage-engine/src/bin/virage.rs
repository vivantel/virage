use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use clap::{Args, Parser, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};
use virage_engine::output::{Out, OutputFormat};
use virage_engine::progress::{finish_stage, Progress};

#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
use virage_engine::config::resolve::resolve_reranker;
use virage_engine::config::resolve::{resolve_embedder, resolve_source, resolve_store};
use virage_engine::config::{default_db_path, find_config, load_config, VirageConfigJson};
use virage_engine::db::VirageDb;
use virage_engine::embedders::Embedder;
use virage_engine::pipeline::{coordinator::run_pipeline, PipelineConfig, ProgressCounters};
use virage_engine::stores::{SearchOptions, VectorStore};

// ─── CLI definition ───────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "virage",
    version = env!("CARGO_PKG_VERSION"),
    about = "Virage — AI code-search indexer (CE)",
    long_about = None,
)]
struct Cli {
    /// Increase verbosity (stackable: -v, -vv … -vvvvv)
    #[arg(short = 'v', global = true, action = clap::ArgAction::Count)]
    verbose: u8,

    /// Suppress the startup banner
    #[arg(long = "no-banner", global = true)]
    no_banner: bool,

    /// Output format: human (default), json (machine-readable), quiet (errors only)
    #[arg(long, global = true, value_enum, default_value_t = CliFormat::Human)]
    format: CliFormat,

    /// Disable ANSI colors (also honoured via NO_COLOR env var)
    #[arg(long = "no-color", global = true)]
    no_color: bool,

    /// Path to virage.config.json (overrides auto-discovery)
    #[arg(short = 'c', long, global = true, default_value = "")]
    config: String,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Clone, Copy, Debug, PartialEq, clap::ValueEnum)]
enum CliFormat {
    Human,
    Json,
    Quiet,
}

impl From<CliFormat> for OutputFormat {
    fn from(f: CliFormat) -> Self {
        match f {
            CliFormat::Human => OutputFormat::Human,
            CliFormat::Json => OutputFormat::Json,
            CliFormat::Quiet => OutputFormat::Quiet,
        }
    }
}

#[derive(Subcommand)]
enum Commands {
    /// Index (or re-index) source files into the vector store.
    #[command(aliases = ["i"])]
    Index(IndexArgs),
    /// Search the vector index with a natural-language query.
    #[command(aliases = ["q"])]
    Query(QueryArgs),
    /// Validate the config file and report issues.
    #[command(aliases = ["val", "v"])]
    Validate(ConfigPathArg),
    /// Check index metadata against the current embedder config.
    #[command(aliases = ["c"])]
    Check(ConfigPathArg),
    /// Show indexing run diagnostics from the state DB.
    #[command(aliases = ["r"])]
    Report(DbPathArg),
    /// Interactive setup wizard.
    Init(ConfigPathArg),
    /// Update virage ecosystem packages and the binary.
    #[command(aliases = ["up"])]
    Update,
    /// Migrate a v1 virage.config.json to v2 format.
    Migrate(ConfigPathArg),
    /// Pack the `.virage/` directory as a `.tar.gz` archive.
    Pack(PackArgs),
    /// Write git post-merge and post-checkout hooks.
    #[command(aliases = ["hooks"])]
    InstallHooks(ConfigPathArg),
    /// Remove hooks, DB, config, and optionally the global binary.
    #[command(aliases = ["un"])]
    Uninstall,
    /// Manage telemetry settings.
    #[command(aliases = ["tm"])]
    Telemetry(TelemetryArgs),
    /// Vector store sub-commands.
    Store(StoreArgs),
    /// Chunk-level sub-commands.
    Chunks(ChunksArgs),
    /// Start the MCP stdio server.
    Serve(ConfigPathArg),
    /// Test a WASM plugin against fixture data.
    Plugin(PluginArgs),
    /// Print the virage-agent-claude usage notice.
    #[command(aliases = ["use"])]
    Usage,
    /// Print the first 20 lines of each skill file.
    #[command(aliases = ["skill"])]
    ReadSkillSummary,
    /// Show health summary: config, index, store, providers.
    Status(DbPathArg),
    /// Self-diagnostic with remediation steps.
    Doctor(DbPathArg),
    /// Generate shell completion script.
    Completions {
        /// Target shell.
        shell: clap_complete::Shell,
    },
    /// Start the virage dashboard web UI (requires Node.js).
    #[command(aliases = ["d"])]
    Dashboard(DashboardArgs),
    /// [Deferred post-v2] Visualise embeddings.
    Viz,
    /// Validate, then run quality metrics and exit 1 if any gate fails.
    #[command(aliases = ["ql"])]
    Quality(QualityArgs),
}

// ─── Arg structs ──────────────────────────────────────────────────────────────

#[derive(Args)]
struct ConfigPathArg {}

#[derive(Args)]
struct DbPathArg {
    /// Path to virage.db.
    #[arg(long, default_value = "")]
    db: String,
}

#[derive(Args)]
struct IndexArgs {
    /// Re-index all files even if unchanged.
    #[arg(long)]
    force: bool,
    /// Show what would change without writing anything.
    #[arg(long)]
    dry_run: bool,
    /// Number of parallel worker tasks.
    #[arg(long)]
    workers: Option<usize>,
    /// Path to virage.db.
    #[arg(long, default_value = "")]
    db: String,
    /// Re-run pipeline on file changes (stub — not yet implemented).
    #[arg(long)]
    watch: bool,
    /// Index locally without uploading to the vector store.
    #[arg(long)]
    no_upload: bool,
}

#[derive(Args)]
struct QueryArgs {
    /// The query text.
    query: String,
    /// Number of results to return.
    #[arg(long, default_value_t = 5)]
    top_k: usize,
    /// [deprecated] Use --format json instead.
    #[arg(long, hide = true)]
    json: bool,
    /// Enable hybrid (dense + sparse) search.
    #[arg(long)]
    hybrid: bool,
    /// Hybrid search alpha weight (0.0 = sparse only, 1.0 = dense only).
    #[arg(long)]
    hybrid_alpha: Option<f32>,
    /// Apply cross-encoder reranker after retrieval.
    #[arg(long)]
    rerank: bool,
    /// Filter results to a specific branch.
    #[arg(long)]
    branch: Option<String>,
    /// Minimum similarity threshold (0–1).
    #[arg(long)]
    min_similarity: Option<f32>,
}

#[derive(Args)]
struct PackArgs {
    /// Output file path (default: virage-backup.tar.gz).
    #[arg(short, long, default_value = "virage-backup.tar.gz")]
    output: String,
}

#[derive(Args)]
struct TelemetryArgs {
    #[command(subcommand)]
    command: TelemetryCommand,
}

#[derive(Subcommand)]
enum TelemetryCommand {
    /// Show telemetry status and buffer info.
    Status,
    /// Enable telemetry collection.
    On,
    /// Disable telemetry collection.
    Off,
    /// Preview the pending telemetry payload.
    Preview,
    /// Flush buffered telemetry events.
    Flush,
    /// Interactive telemetry configuration wizard.
    Init,
}

#[derive(Args)]
struct StoreArgs {
    #[command(subcommand)]
    command: StoreCommand,
}

#[derive(Subcommand)]
enum StoreCommand {
    /// Print vector store statistics.
    Stats(ConfigPathArg),
    /// Run a query-performance benchmark.
    Perf(ConfigPathArg),
}

#[derive(Args)]
struct ChunksArgs {
    #[command(subcommand)]
    command: ChunksCommand,
}

#[derive(Subcommand)]
enum ChunksCommand {
    /// Dump chunk data from the state DB.
    Report(DbPathArg),
}

#[derive(Args)]
struct PluginArgs {
    #[command(subcommand)]
    command: PluginCommand,
}

#[derive(Subcommand)]
enum PluginCommand {
    /// Load and smoke-test a WASM plugin.
    Test {
        /// Path to the .wasm file.
        path: String,
    },
}

#[derive(Args)]
struct DashboardArgs {
    /// Port to listen on.
    #[arg(long, default_value_t = 3000)]
    port: u16,
    /// Path to virage.db.
    #[arg(long, default_value = "")]
    db: String,
}

#[derive(Args)]
struct QualityArgs {
    #[command(subcommand)]
    command: Option<QualityCommand>,
}

#[derive(Subcommand)]
enum QualityCommand {
    Eval(QualityEvalArgs),
    Bench,
    Suite,
    History,
}

#[derive(Args)]
struct QualityEvalArgs {
    #[command(subcommand)]
    command: QualityEvalCommand,
}

#[derive(Subcommand)]
enum QualityEvalCommand {
    Run,
    Generate,
    Save,
    List,
    Compare,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Returns the correct npm binary name for the current OS.
/// On Windows, `npm` is a batch script (`npm.cmd`), not a native executable.
fn npm_bin() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

struct PackageStatus {
    name: String,
    current: String,
    latest: String,
    outdated: bool,
}

/// Queries `npm view <pkg> version --json` and returns the latest published version.
fn get_npm_latest(npm: &str, pkg: &str) -> Option<String> {
    let output = std::process::Command::new(npm)
        .args(["view", pkg, "version", "--json", "--prefer-online"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    serde_json::from_str::<String>(&s).ok()
}

/// Returns the currently installed version of a package, checking local node_modules
/// then falling back to `npm list --global`.
fn get_npm_current(npm: &str, pkg: &str, cwd: &Path) -> Option<String> {
    let local_pkg = cwd.join("node_modules").join(pkg).join("package.json");
    if let Ok(raw) = std::fs::read_to_string(local_pkg) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(ver) = v.get("version").and_then(|v| v.as_str()) {
                return Some(ver.to_string());
            }
        }
    }
    let out = std::process::Command::new(npm)
        .args(["list", pkg, "--global", "--json", "--depth=0"])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(&s).ok()?;
    v.get("dependencies")
        .and_then(|d| d.get(pkg))
        .and_then(|p| p.get("version"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Discovers all @vivantel/* packages referenced in virage.config.json and package.json.
fn discover_virage_packages(cwd: &Path, config_path: &str) -> Vec<String> {
    let mut packages = std::collections::BTreeSet::new();

    if let Ok(raw) = std::fs::read_to_string(config_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(providers) = v.get("providers").and_then(|p| p.as_object()) {
                for provider in providers.values() {
                    if let Some(pkg) = provider.get("package").and_then(|p| p.as_str()) {
                        packages.insert(pkg.to_string());
                    }
                }
            }
            if let Some(agents) = v.get("agents").and_then(|a| a.as_array()) {
                for agent in agents {
                    if let Some(pkg) = agent.get("package").and_then(|p| p.as_str()) {
                        packages.insert(pkg.to_string());
                    }
                }
            }
            if let Some(file_sets) = v.get("fileSets").and_then(|f| f.as_array()) {
                for fs in file_sets {
                    if let Some(chunkers) = fs.get("chunkers").and_then(|c| c.as_array()) {
                        for chunker in chunkers {
                            if let Some(pkg) = chunker.get("package").and_then(|p| p.as_str()) {
                                packages.insert(pkg.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let pkg_json = cwd.join("package.json");
    if let Ok(raw) = std::fs::read_to_string(pkg_json) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            for key in ["dependencies", "devDependencies"] {
                if let Some(deps) = v.get(key).and_then(|d| d.as_object()) {
                    for name in deps.keys() {
                        if name.starts_with("@vivantel/") {
                            packages.insert(name.clone());
                        }
                    }
                }
            }
        }
    }

    packages.into_iter().collect()
}

/// Scans `dir` for file types, returning a map of type name → file count.
/// Skips common non-source directories (node_modules, dist, target, etc.).
fn detect_file_types(dir: &Path) -> HashMap<&'static str, usize> {
    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    if !dir.exists() {
        return counts;
    }
    let skip = [
        "node_modules",
        "dist",
        "target",
        ".git",
        ".virage",
        "__pycache__",
        ".next",
        "build",
        "vendor",
    ];
    for entry in walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_entry(|e| {
            !e.file_type().is_dir() || !skip.contains(&e.file_name().to_str().unwrap_or(""))
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let ext = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let kind: &'static str = match ext {
            "ts" | "tsx" => "TypeScript",
            "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
            "py" => "Python",
            "rs" => "Rust",
            "go" => "Go",
            "java" | "kt" | "kts" => "Java / Kotlin",
            "cs" | "cpp" | "c" | "h" | "hpp" => "C# / C++",
            "md" | "mdx" => "Markdown",
            "pdf" => "PDF",
            "docx" => "Word / DOCX",
            "tex" => "LaTeX",
            _ => continue,
        };
        *counts.entry(kind).or_insert(0) += 1;
    }
    counts
}

fn resolve_config_path(arg: &str) -> anyhow::Result<String> {
    if !arg.is_empty() {
        return Ok(arg.to_string());
    }
    find_config().ok_or_else(|| {
        anyhow::anyhow!(
            "No config found. Tried: {:?}. Run `virage init` to create one.",
            virage_engine::config::CONFIG_CANDIDATES
        )
    })
}

fn resolve_db_path(arg: &str) -> String {
    if arg.is_empty() {
        default_db_path()
    } else {
        arg.to_string()
    }
}

fn open_or_init_db(path: &str) -> anyhow::Result<VirageDb> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    VirageDb::open(p).map_err(|e| anyhow::anyhow!("Cannot open state DB {:?}: {e}", path))
}

fn embedder_dims(cfg: &VirageConfigJson) -> usize {
    cfg.providers
        .embedder
        .usize_opt("dimensions")
        .unwrap_or(384)
}

fn virage_theme() -> dialoguer::theme::ColorfulTheme {
    use console::Style;
    dialoguer::theme::ColorfulTheme {
        active_item_style: Style::new().cyan().bold(),
        active_item_prefix: console::style("❯ ".to_string()).cyan().bold(),
        inactive_item_prefix: console::style("  ".to_string()),
        checked_item_prefix: console::style("[✓]".to_string()).green(),
        unchecked_item_prefix: console::style("[ ]".to_string()).dim(),
        ..Default::default()
    }
}

fn spinner(msg: &str) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("{spinner:.cyan} {msg}")
            .unwrap()
            .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]),
    );
    pb.set_message(msg.to_string());
    pb.enable_steady_tick(std::time::Duration::from_millis(80));
    pb
}

// ─── Command implementations ──────────────────────────────────────────────────

async fn cmd_index(
    args: IndexArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    if verbose >= 5 {
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_writer(std::io::stderr)
            .init();
    }

    let t0 = std::time::Instant::now();
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    let cfg = load_config(&config_path)?;
    let db_path = resolve_db_path(&args.db);
    let cwd = std::env::current_dir()?;
    let dims = embedder_dims(&cfg);

    let force = args.force || cfg.pipeline.as_ref().and_then(|p| p.force).unwrap_or(false);
    let dry_run = args.dry_run
        || cfg
            .pipeline
            .as_ref()
            .and_then(|p| p.dry_run)
            .unwrap_or(false);

    // ── Resolve providers ─────────────────────────────────────────────────────
    let prog = Progress::new(format);

    let t_stage = std::time::Instant::now();
    let stage = prog.stage("Loading embedder...");
    let embedder = resolve_embedder(&cfg.providers.embedder)?;
    finish_stage(stage);
    out.verbose(&format!(
        "embedder: {}  ({}ms)",
        cfg.providers.embedder.package,
        t_stage.elapsed().as_millis()
    ));

    let t_stage = std::time::Instant::now();
    let stage = prog.stage("Connecting to vector store...");
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    finish_stage(stage);
    out.verbose(&format!(
        "store: {}  ({}ms)",
        cfg.providers.vector_store.package,
        t_stage.elapsed().as_millis()
    ));

    let t_stage = std::time::Instant::now();
    let stage = prog.stage("Opening state DB...");
    let db = open_or_init_db(&db_path)?;
    let known_revisions: HashMap<String, String> = if force {
        HashMap::new()
    } else {
        db.get_file_revisions()
            .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?
    };
    finish_stage(stage);
    out.verbose(&format!("state DB: {}ms", t_stage.elapsed().as_millis()));

    let t_stage = std::time::Instant::now();
    let stage = prog.stage("Resolving source...");
    let source = resolve_source(cfg.providers.source.as_ref(), &cwd)?;
    finish_stage(stage);
    out.verbose(&format!(
        "source: {}  ({}ms)",
        cfg.providers
            .source
            .as_ref()
            .map(|s| s.package.as_str())
            .unwrap_or("localfs"),
        t_stage.elapsed().as_millis()
    ));

    if args.watch {
        use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
        use std::sync::mpsc::TryRecvError;

        // Run initial full index before entering watch loop.
        {
            let progress = ProgressCounters::new();
            let workers = args
                .workers
                .or_else(|| cfg.pipeline.as_ref().and_then(|p| p.concurrency))
                .unwrap_or_else(|| {
                    std::thread::available_parallelism()
                        .map(|n| n.get())
                        .unwrap_or(4)
                });
            let pipeline_cfg = PipelineConfig {
                workers,
                upload_batch_size: cfg
                    .pipeline
                    .as_ref()
                    .and_then(|p| p.min_upload_batch_size)
                    .unwrap_or(64),
                max_tokens: 512,
                progress: Some(progress.clone()),
                skip_upload: args.no_upload,
                ..Default::default()
            };
            let file_bar = prog.file_bar(0, "Indexing");
            let chunk_bar = prog.stage("0 chunks embedded");
            let pt = {
                let p = progress.clone();
                let fb = file_bar.clone();
                let cb = chunk_bar.clone();
                tokio::spawn(async move {
                    loop {
                        let (total, _, done, chunks) = p.snapshot();
                        if total > 0 {
                            fb.set_length(total as u64);
                            fb.set_position(done as u64);
                        }
                        cb.set_message(format!("{chunks} chunks embedded"));
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                })
            };
            let _ = run_pipeline(
                &pipeline_cfg,
                source.clone(),
                vec![],
                embedder.clone(),
                store.clone(),
                known_revisions.clone(),
            )
            .await;
            pt.abort();
            file_bar.finish_and_clear();
            chunk_bar.finish_and_clear();
        }

        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = new_debouncer(std::time::Duration::from_millis(300), tx)
            .map_err(|e| anyhow::anyhow!("watcher error: {e}"))?;
        debouncer
            .watcher()
            .watch(&cwd, RecursiveMode::Recursive)
            .map_err(|e| anyhow::anyhow!("watcher error: {e}"))?;

        let indexed = db.get_file_revisions().map(|m| m.len()).unwrap_or(0);
        out.info(&format!(
            "Watching — {indexed} files indexed · Ctrl+C to stop"
        ));

        loop {
            match rx.try_recv() {
                Ok(Ok(events)) => {
                    let changed: Vec<_> = events
                        .iter()
                        .filter(|e| !e.path.to_string_lossy().contains(".virage"))
                        .collect();
                    if changed.is_empty() {
                        continue;
                    }

                    let now = {
                        let d = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default();
                        let secs = d.as_secs();
                        format!(
                            "{:02}:{:02}:{:02}",
                            (secs / 3600) % 24,
                            (secs / 60) % 60,
                            secs % 60
                        )
                    };
                    eprintln!("[{now}] {} file(s) changed — re-indexing...", changed.len());

                    let t_watch = std::time::Instant::now();
                    let known = db.get_file_revisions().unwrap_or_default();
                    let progress = ProgressCounters::new();
                    let workers = args
                        .workers
                        .or_else(|| cfg.pipeline.as_ref().and_then(|p| p.concurrency))
                        .unwrap_or(4);
                    let pipeline_cfg = PipelineConfig {
                        workers,
                        upload_batch_size: cfg
                            .pipeline
                            .as_ref()
                            .and_then(|p| p.min_upload_batch_size)
                            .unwrap_or(64),
                        max_tokens: 512,
                        progress: Some(progress.clone()),
                        skip_upload: args.no_upload,
                        ..Default::default()
                    };
                    match run_pipeline(
                        &pipeline_cfg,
                        source.clone(),
                        vec![],
                        embedder.clone(),
                        store.clone(),
                        known,
                    )
                    .await
                    {
                        Ok(stats) => {
                            let ms = t_watch.elapsed().as_millis();
                            let count = db.get_file_revisions().map(|m| m.len()).unwrap_or(0);
                            eprintln!(
                                "  ✓ Done — {} file(s) · {} chunks · {ms}ms · {count} total",
                                stats.files_processed, stats.chunks_upserted
                            );
                        }
                        Err(e) => {
                            eprintln!("  ⚠ Re-index failed — {e}");
                            eprintln!("      Watching continues. Fix the file to re-trigger.");
                        }
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("⚠ Watch error: {e:?}");
                }
                Err(TryRecvError::Empty) => {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
                Err(TryRecvError::Disconnected) => break,
            }
        }
        eprintln!("Stopped watching.");
        std::process::exit(130);
    }

    // ── Dry-run mode ──────────────────────────────────────────────────────────
    if dry_run {
        use futures::StreamExt;
        out.section("Dry Run");
        let mut stream = source.list_all(None);
        let mut all_paths = Vec::new();
        while let Some(item) = stream.next().await {
            all_paths.push(item?.path);
        }
        let path_refs: Vec<&str> = all_paths.iter().map(String::as_str).collect();
        let current_revs = source.file_revisions(&path_refs).await?;
        let to_process: Vec<&str> = all_paths
            .iter()
            .filter(|p| {
                let cur = current_revs.get(*p).map(String::as_str).unwrap_or("");
                let known = known_revisions.get(*p).map(String::as_str).unwrap_or("");
                cur != known
            })
            .map(String::as_str)
            .collect();
        let to_delete: Vec<&str> = known_revisions
            .keys()
            .filter(|k| !all_paths.contains(k))
            .map(String::as_str)
            .collect();
        out.info(&format!("  Files to index  : {}", to_process.len()));
        out.info(&format!(
            "  Files unchanged : {}",
            all_paths.len().saturating_sub(to_process.len())
        ));
        out.info(&format!("  Files to delete : {}", to_delete.len()));
        return Ok(());
    }

    // ── Pipeline run ──────────────────────────────────────────────────────────
    let workers = args
        .workers
        .or_else(|| cfg.pipeline.as_ref().and_then(|p| p.concurrency))
        .unwrap_or_else(|| {
            std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4)
        });

    let progress = ProgressCounters::new();
    let pipeline_cfg = PipelineConfig {
        workers,
        upload_batch_size: cfg
            .pipeline
            .as_ref()
            .and_then(|p| p.min_upload_batch_size)
            .unwrap_or(64),
        max_tokens: 512,
        progress: Some(progress.clone()),
        skip_upload: args.no_upload,
        ..Default::default()
    };

    // ── Multi-stage progress display ──────────────────────────────────────────
    let file_bar = prog.file_bar(0, "Indexing");
    let chunk_bar = prog.stage("0 chunks embedded");

    let progress_task = {
        let p = progress.clone();
        let fb = file_bar.clone();
        let cb = chunk_bar.clone();
        tokio::spawn(async move {
            loop {
                let (total, _, done, chunks) = p.snapshot();
                if total > 0 {
                    fb.set_length(total as u64);
                    fb.set_position(done as u64);
                }
                cb.set_message(format!("{chunks} chunks embedded"));
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        })
    };

    let stats = run_pipeline(
        &pipeline_cfg,
        source.clone(),
        vec![],
        embedder,
        store.clone(),
        known_revisions,
    )
    .await?;

    progress_task.abort();
    file_bar.finish_and_clear();
    chunk_bar.finish_and_clear();

    out.debug_msg(&format!(
        "pipeline: {} files processed  {} chunks upserted  {} skipped  {} deleted",
        stats.files_processed, stats.chunks_upserted, stats.files_skipped, stats.files_deleted
    ));
    if verbose >= 4 {
        let (total, queued, done, chunks) = progress.snapshot();
        out.debug_msg(&format!(
            "ProgressCounters: total={total} queued={queued} done={done} chunks={chunks}"
        ));
    }

    // ── Update state DB with new revisions ────────────────────────────────────
    // Re-query current file revisions from the source now that the pipeline is done.
    let t_db = std::time::Instant::now();
    {
        use futures::StreamExt;
        let mut stream = source.list_all(None);
        let mut all_paths = Vec::new();
        while let Some(item) = stream.next().await {
            all_paths.push(item?.path);
        }
        let path_refs: Vec<&str> = all_paths.iter().map(String::as_str).collect();
        let new_revs = source.file_revisions(&path_refs).await?;
        for (file, rev) in &new_revs {
            db.set_file_revision(file, rev)
                .map_err(|e| anyhow::anyhow!("DB write error: {e}"))?;
        }
        // Remove deleted files from DB.
        let source_set: std::collections::HashSet<&str> =
            all_paths.iter().map(String::as_str).collect();
        for file in db
            .get_file_revisions()
            .unwrap_or_default()
            .keys()
            .filter(|k| !source_set.contains(k.as_str()))
            .cloned()
            .collect::<Vec<_>>()
        {
            let _ = db.delete_file(&file);
        }
    }
    out.debug_msg(&format!("DB flush: {}ms", t_db.elapsed().as_millis()));

    let elapsed_ms = t0.elapsed().as_millis();
    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "filesProcessed": stats.files_processed,
            "filesSkipped": stats.files_skipped,
            "filesDeleted": stats.files_deleted,
            "chunksUpserted": stats.chunks_upserted,
            "elapsedMs": elapsed_ms,
        }));
    } else {
        out.success(&format!(
            "Done.  Processed: {}  Skipped: {}  Deleted: {}  Chunks: {}  ({elapsed_ms}ms)",
            stats.files_processed, stats.files_skipped, stats.files_deleted, stats.chunks_upserted,
        ));
    }
    // Write index metadata for `virage check` comparisons.
    let _ = store
        .write_meta(&virage_engine::stores::IndexMeta {
            model: cfg.providers.embedder.package.clone(),
            dimensions: dims,
        })
        .await;
    let _ = db.record_cli_command("index", t0.elapsed().as_millis() as u64, true);
    Ok(())
}

async fn cmd_query(
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

async fn cmd_validate(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let t0 = std::time::Instant::now();
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    out.section("Validate");
    out.dim(&format!("Config: {config_path}"));

    // A1 — spinner around load_config()
    let pb = spinner("Loading config...");
    let cfg = load_config(&config_path)?;
    pb.finish_and_clear();

    if cfg.file_sets.is_empty() {
        return Err(anyhow::anyhow!("fileSets must have at least one entry"));
    }

    let mut warnings = 0usize;
    let mut warning_msgs: Vec<String> = Vec::new();
    let mut file_set_counts: Vec<serde_json::Value> = Vec::new();
    let cwd = std::env::current_dir()?;

    // A2 — spinner around glob file scan loop (E1: count matches per fileSet)
    let pb = spinner("Scanning file patterns...");
    for fs in &cfg.file_sets {
        if fs.chunkers.is_empty() {
            out.warn(&format!("fileSet {:?}: chunkers is empty", fs.name));
            warnings += 1;
        }
        if fs.include.is_empty() {
            out.warn(&format!(
                "fileSet {:?}: no include patterns — will match nothing",
                fs.name
            ));
            warnings += 1;
            continue;
        }

        // E1: build a globset and count matches on disk
        let mut builder = globset::GlobSetBuilder::new();
        let mut pattern_errors = 0usize;
        for pat in &fs.include {
            match globset::Glob::new(pat) {
                Ok(g) => {
                    out.verbose(&format!("fileSet {:?}: pattern {:?} OK", fs.name, pat));
                    builder.add(g);
                }
                Err(e) => {
                    out.warn(&format!(
                        "fileSet {:?}: invalid pattern {:?}: {e}",
                        fs.name, pat
                    ));
                    warnings += 1;
                    pattern_errors += 1;
                }
            }
        }
        if pattern_errors == fs.include.len() {
            continue;
        }
        let globset = builder.build().unwrap_or_default();
        let match_count = walkdir::WalkDir::new(&cwd)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter(|e| {
                e.path()
                    .strip_prefix(&cwd)
                    .map(|rel| globset.is_match(rel))
                    .unwrap_or(false)
            })
            .count();
        out.info(&format!(
            "  fileSet {:?}: {} file(s) matched",
            fs.name, match_count
        ));
        file_set_counts.push(serde_json::json!({
            "name": fs.name,
            "matchCount": match_count,
        }));
        if match_count == 0 {
            let msg = format!("fileSet {:?}: no files matched include patterns", fs.name);
            out.warn(&msg);
            warning_msgs.push(msg);
            warnings += 1;
        }
    }
    pb.finish_and_clear();

    // E3: file type coverage — detect types and check gaps
    let detected = detect_file_types(&cwd);
    let all_includes: Vec<&str> = cfg
        .file_sets
        .iter()
        .flat_map(|fs| fs.include.iter().map(String::as_str))
        .collect();
    for (type_name, count) in &detected {
        let type_patterns = FILE_TYPE_META
            .iter()
            .find(|(k, _, _, _)| k == type_name)
            .map(|(_, _, pats, _)| *pats)
            .unwrap_or(&[]);
        let covered = type_patterns.iter().any(|tp| {
            all_includes
                .iter()
                .any(|inc| inc == tp || inc.contains(tp.trim_start_matches("**/")))
        });
        if !covered {
            out.warn(&format!(
                "File type {:?} ({count} file(s)) not covered by any fileSet include pattern",
                type_name
            ));
            warnings += 1;
        }
    }

    out.info(&format!("\nEmbedder : {}", cfg.providers.embedder.package));
    out.info(&format!(
        "Store    : {}",
        cfg.providers.vector_store.package
    ));
    if let Some(src) = &cfg.providers.source {
        out.info(&format!("Source   : {}", src.package));
    }
    out.info(&format!("FileSets : {}", cfg.file_sets.len()));

    // A3/E2 — spinner around store.initialize(); warn on error, don't abort
    let pb = spinner("Connecting to vector store...");
    let dims = embedder_dims(&cfg);
    match resolve_store(&cfg.providers.vector_store, dims) {
        Ok(store) => match store.initialize().await {
            Ok(_) => out.verbose("Vector store reachable."),
            Err(e) => {
                out.warn(&format!("Vector store not reachable: {e}"));
                warnings += 1;
            }
        },
        Err(e) => {
            out.warn(&format!("Could not resolve vector store: {e}"));
            warnings += 1;
        }
    }
    pb.finish_and_clear();

    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "valid": warnings == 0,
            "warnings": warning_msgs,
            "fileSets": file_set_counts,
        }));
    } else if warnings > 0 {
        out.warn(&format!("Config loaded with {warnings} warning(s)."));
    } else {
        out.success("Config is valid.");
    }
    let db_path = resolve_db_path("");
    if let Ok(db) = open_or_init_db(&db_path) {
        let _ = db.record_cli_command("validate", t0.elapsed().as_millis() as u64, true);
    }
    Ok(())
}

async fn cmd_check(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let t0 = std::time::Instant::now();
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    let cfg = load_config(&config_path)?;
    let dims = embedder_dims(&cfg);

    let pb = spinner("Connecting to vector store...");
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;
    pb.finish_and_clear();

    let state = store.current_state().await?;
    out.section("Index Check");
    out.info(&format!(
        "Vector store  : {}",
        cfg.providers.vector_store.package
    ));
    out.info(&format!("Indexed files : {}", state.len()));
    out.info(&format!("Dimensions    : {dims}"));

    // F2: compare stored metadata against current config
    let mut ok = true;
    match store.read_meta().await? {
        None => {
            out.warn("No index metadata found — run `virage index` to build the index.");
        }
        Some(meta) => {
            let config_model = &cfg.providers.embedder.package;
            if &meta.model != config_model {
                out.error(&format!(
                    "Embedder mismatch: index uses {:?}, config has {:?}",
                    meta.model, config_model
                ));
                ok = false;
            }
            if meta.dimensions != dims {
                out.error(&format!(
                    "Dimension mismatch: index has {}, config has {dims}",
                    meta.dimensions
                ));
                ok = false;
            }
        }
    }

    let db_path = resolve_db_path("");
    if let Ok(db) = open_or_init_db(&db_path) {
        let _ = db.record_cli_command("check", t0.elapsed().as_millis() as u64, ok);
    }

    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "ok": ok,
            "embedder": cfg.providers.embedder.package,
            "dimensions": dims,
        }));
        if !ok {
            std::process::exit(1);
        }
        Ok(())
    } else if ok {
        out.success("Status: OK");
        Ok(())
    } else {
        out.error("Index metadata does not match config — re-run `virage index`.");
        std::process::exit(1);
    }
}

fn cmd_report(args: DbPathArg, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let db_path = resolve_db_path(&args.db);
    let db = open_or_init_db(&db_path)?;

    let revisions = db
        .get_file_revisions()
        .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;
    let pending_embed = db
        .pending_embed_count()
        .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;
    let pending_upload = db
        .pending_upload_count()
        .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;

    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "dbPath": db_path,
            "indexedFiles": revisions.len(),
            "pendingEmbed": pending_embed,
            "pendingUpload": pending_upload,
        }));
    } else {
        out.section("Virage Report");
        out.info(&format!("DB path          : {db_path}"));
        out.info(&format!("Indexed files    : {}", revisions.len()));
        out.info(&format!("Pending embed    : {pending_embed}"));
        out.info(&format!("Pending upload   : {pending_upload}"));
    }
    Ok(())
}

fn cmd_chunks_report(args: DbPathArg, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let db_path = resolve_db_path(&args.db);
    let db = open_or_init_db(&db_path)?;
    let revisions = db
        .get_file_revisions()
        .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;

    if revisions.is_empty() {
        out.warn(&format!("No indexed files found in {db_path}."));
        return Ok(());
    }

    out.section(&format!("Chunks Report ({} files)", revisions.len()));
    let mut files: Vec<_> = revisions.iter().collect();
    files.sort_by_key(|(k, _)| k.as_str());
    for (file, rev) in &files {
        out.dim(&format!("  {}  [{}]", file, &rev[..rev.len().min(8)]));
    }
    Ok(())
}

async fn cmd_store_stats(
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

async fn cmd_store_perf(
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

fn cmd_migrate(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    let text = std::fs::read_to_string(&config_path)
        .map_err(|e| anyhow::anyhow!("Cannot read {:?}: {e}", config_path))?;
    let mut value: serde_json::Value = serde_json::from_str(&text)?;

    let already_v2 = value.get("providers").is_some() && value.get("fileSets").is_some();
    if already_v2 {
        out.success("Config is already v2 format — nothing to migrate.");
        return Ok(());
    }
    out.info(&format!("Migrating {config_path} ..."));
    if let Some(obj) = value.as_object_mut() {
        obj.insert("version".into(), serde_json::json!("1.0.0"));
    }
    let backup = format!("{config_path}.bak");
    std::fs::copy(&config_path, &backup)?;
    std::fs::write(&config_path, serde_json::to_string_pretty(&value)?)?;
    out.dim(&format!("Backup saved to {backup}"));
    out.success("Migration complete.");
    Ok(())
}

fn cmd_install_hooks(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config).unwrap_or_else(|_| "virage.config.json".into());
    let hooks_dir = PathBuf::from(".git/hooks");
    if !hooks_dir.exists() {
        return Err(anyhow::anyhow!(
            "No .git/hooks directory found — are you in a git repo?"
        ));
    }
    for hook in &["post-merge", "post-checkout"] {
        let hook_path = hooks_dir.join(hook);
        let script = format!(
            "#!/bin/sh\nvirage index --config '{}' || true\n",
            config_path
        );
        std::fs::write(&hook_path, script)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&hook_path, std::fs::Permissions::from_mode(0o755))?;
        }
        out.success(&format!("Installed hook: {}", hook_path.display()));
    }
    Ok(())
}

fn virage_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("virage")
}

fn cmd_telemetry(args: TelemetryArgs, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let config_dir = virage_config_dir();
    let flag_file = config_dir.join("telemetry.enabled");
    let telemetry_cfg = config_dir.join("telemetry.json");
    match args.command {
        TelemetryCommand::Status => {
            let enabled = flag_file.exists();
            if enabled {
                out.success("Telemetry: enabled");
                if let Ok(raw) = std::fs::read_to_string(&telemetry_cfg) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                        if let Some(ep) = v.get("endpoint").and_then(|e| e.as_str()) {
                            out.dim(&format!("  Endpoint : {ep}"));
                        }
                        if let Some(tier2) = v.get("tier2").and_then(|t| t.as_bool()) {
                            out.dim(&format!("  Tier-2   : {tier2}"));
                        }
                    }
                }
            } else {
                out.warn("Telemetry: disabled");
            }
        }
        TelemetryCommand::On => {
            std::fs::create_dir_all(&config_dir)?;
            std::fs::write(&flag_file, "")?;
            out.success("Telemetry enabled.");
        }
        TelemetryCommand::Off => {
            let _ = std::fs::remove_file(&flag_file);
            out.success("Telemetry disabled.");
        }
        TelemetryCommand::Preview => {
            let db_path = resolve_db_path("");
            let db = open_or_init_db(&db_path)?;
            let rows = db
                .get_pending_telemetry()
                .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;
            if rows.is_empty() {
                out.dim("No pending telemetry events.");
            } else {
                out.section("Pending Telemetry");
                for r in &rows {
                    out.info(&format!(
                        "  [{}] {} {}ms {}",
                        r.id,
                        r.command,
                        r.duration_ms,
                        if r.success { "ok" } else { "err" }
                    ));
                }
            }
        }
        TelemetryCommand::Flush => {
            let db_path = resolve_db_path("");
            let db = open_or_init_db(&db_path)?;
            let rows = db
                .get_pending_telemetry()
                .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;
            if rows.is_empty() {
                out.dim("No events to flush.");
            } else {
                let telemetry_endpoint = "https://telemetry.vivantel.com/v1/cli";
                let payload: Vec<serde_json::Value> = rows
                    .iter()
                    .map(|r| {
                        serde_json::json!({
                            "command": r.command,
                            "durationMs": r.duration_ms,
                            "success": r.success,
                            "recordedAt": r.recorded_at,
                        })
                    })
                    .collect();
                let body = serde_json::to_string(&serde_json::json!({ "events": payload }))?;
                let result = ureq::post(telemetry_endpoint)
                    .set("Content-Type", "application/json")
                    .send_bytes(body.as_bytes());
                match result {
                    Ok(_) => {
                        db.clear_telemetry()
                            .map_err(|e| anyhow::anyhow!("DB clear error: {e}"))?;
                        out.success(&format!("Flushed {} event(s).", rows.len()));
                    }
                    Err(e) => {
                        out.warn(&format!("Flush failed (events retained): {e}"));
                    }
                }
            }
        }
        TelemetryCommand::Init => {
            cmd_telemetry_init(&out, &config_dir, &flag_file, &telemetry_cfg)?;
        }
    }
    Ok(())
}

fn cmd_telemetry_init(
    out: &Out,
    config_dir: &Path,
    flag_file: &Path,
    telemetry_cfg: &Path,
) -> anyhow::Result<()> {
    use dialoguer::{Confirm, Input, Select};

    out.section("Telemetry Setup");

    const BACK: &str = "← Back";
    let mut endpoint = String::from("https://telemetry.vivantel.com");
    let mut api_key = String::new();
    let mut tier2 = false;
    let mut sampling_rate = 5u8;
    let mut step = 0usize;

    loop {
        match step {
            // Step 1: Endpoint type
            0 => {
                let choices = [BACK, "Vivantel hosted (default)", "Custom endpoint"];
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt("Telemetry endpoint")
                    .items(&choices)
                    .default(1)
                    .interact()?;
                match idx {
                    0 => {
                        out.info("Cancelled.");
                        return Ok(());
                    }
                    2 => step = 1,
                    _ => {
                        endpoint = "https://telemetry.vivantel.com".into();
                        step = 2;
                    }
                }
            }
            // Step 2: Custom endpoint URL + API key
            1 => {
                let url: String = Input::with_theme(&virage_theme())
                    .with_prompt("Endpoint URL")
                    .default(endpoint.clone())
                    .interact_text()?;
                let key: String = Input::with_theme(&virage_theme())
                    .with_prompt("API key (leave blank if not required)")
                    .allow_empty(true)
                    .interact_text()?;

                let choices = [BACK, "Continue"];
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt(&format!("Use endpoint {url}?"))
                    .items(&choices)
                    .default(1)
                    .interact()?;
                if idx == 0 {
                    step = 0;
                    continue;
                }
                endpoint = url;
                api_key = key;
                step = 2;
            }
            // Step 3: Tier-2 usage telemetry
            2 => {
                out.dim("Tier-2 telemetry shares anonymised query patterns to improve relevance.");
                let choices = [BACK, "Enable tier-2", "Skip tier-2"];
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt("Enable tier-2 usage telemetry?")
                    .items(&choices)
                    .default(2)
                    .interact()?;
                match idx {
                    0 => {
                        step = if api_key.is_empty() && endpoint.contains("vivantel") {
                            0
                        } else {
                            1
                        };
                        continue;
                    }
                    1 => {
                        tier2 = true;
                        step = 3;
                    }
                    _ => {
                        tier2 = false;
                        step = 4;
                    }
                }
            }
            // Step 4: Sampling rate (only if tier-2 enabled)
            3 => {
                let choices = [BACK, "1% (minimal)", "5% (default)", "10%", "100% (full)"];
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt("Sampling rate")
                    .items(&choices)
                    .default(2)
                    .interact()?;
                match idx {
                    0 => {
                        step = 2;
                        continue;
                    }
                    1 => sampling_rate = 1,
                    3 => sampling_rate = 10,
                    4 => sampling_rate = 100,
                    _ => sampling_rate = 5,
                }
                step = 4;
            }
            // Step 5: Confirm
            4 => {
                out.section("Summary");
                out.info(&format!("  Endpoint    : {endpoint}"));
                if !api_key.is_empty() {
                    out.info("  API key     : ****");
                }
                out.info(&format!("  Tier-2      : {tier2}"));
                if tier2 {
                    out.info(&format!("  Sampling    : {sampling_rate}%"));
                }
                println!();

                let choices = [BACK, "Save and enable", "Cancel"];
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt("Confirm")
                    .items(&choices)
                    .default(1)
                    .interact()?;
                match idx {
                    0 => {
                        step = if tier2 { 3 } else { 2 };
                        continue;
                    }
                    2 => {
                        out.info("Cancelled.");
                        return Ok(());
                    }
                    _ => {}
                }
                break;
            }
            _ => break,
        }
    }

    // Write config
    std::fs::create_dir_all(config_dir)?;
    let mut cfg = serde_json::json!({
        "endpoint": endpoint,
        "tier2": tier2,
    });
    if !api_key.is_empty() {
        cfg["apiKey"] = serde_json::Value::String(api_key);
    }
    if tier2 {
        cfg["samplingRate"] = serde_json::Value::Number(sampling_rate.into());
    }
    std::fs::write(telemetry_cfg, serde_json::to_string_pretty(&cfg)?)?;
    std::fs::write(flag_file, "")?;
    out.success("Telemetry configured and enabled.");
    Ok(())
}

fn cmd_quality(
    args: QualityArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let stub = |label: &str| out.dim(&format!("{label}: not yet implemented (Phase 5b)"));
    match args.command {
        None => {
            let config_path = resolve_config_path(config)?;
            out.section("Quality Metrics");
            out.dim(&format!("Config: {config_path}"));
            stub("quality");
        }
        Some(QualityCommand::Eval(eval_args)) => match eval_args.command {
            QualityEvalCommand::Run => stub("quality eval run"),
            QualityEvalCommand::Generate => stub("quality eval generate"),
            QualityEvalCommand::Save => stub("quality eval save"),
            QualityEvalCommand::List => stub("quality eval list"),
            QualityEvalCommand::Compare => stub("quality eval compare"),
        },
        Some(QualityCommand::Bench) => stub("quality bench"),
        Some(QualityCommand::Suite) => stub("quality suite"),
        Some(QualityCommand::History) => stub("quality history"),
    }
    Ok(())
}

// ─── init ────────────────────────────────────────────────────────────────────

fn package_to_builtin(pkg: &str) -> Option<&'static str> {
    match pkg {
        "@vivantel/virage-chunker-ce-lang" => Some("lang"),
        "@vivantel/virage-chunker-ce-md" => Some("md"),
        "@vivantel/virage-chunker-ce-pdf" => Some("pdf"),
        "@vivantel/virage-chunker-ce-docx" => Some("docx"),
        "@vivantel/virage-chunker-ce-latex" => Some("latex"),
        "@vivantel/virage-embedder-onnx" => Some("onnx"),
        "@vivantel/virage-embedder-fastembed" => Some("fastembed"),
        "@vivantel/virage-store-lancedb" => Some("lancedb"),
        "@vivantel/virage-store-qdrant" => Some("qdrant"),
        "@vivantel/virage-store-postgres" => Some("postgres"),
        "@vivantel/virage-store-chromadb" => Some("chromadb"),
        "@vivantel/virage-reranker-cross-encoder" => Some("cross-encoder"),
        "@vivantel/virage-source-git" => Some("git"),
        "@vivantel/virage-source-localfs" => Some("localfs"),
        _ => None,
    }
}

/// File-type metadata: (key used by detect_file_types, display label, include patterns, chunker pkg)
const FILE_TYPE_META: &[(&str, &str, &[&str], &str)] = &[
    (
        "TypeScript",
        "TypeScript (.ts, .tsx)",
        &["**/*.ts", "**/*.tsx"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "JavaScript",
        "JavaScript (.js, .jsx, .mjs)",
        &["**/*.js", "**/*.jsx", "**/*.mjs"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "Python",
        "Python (.py)",
        &["**/*.py"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "Rust",
        "Rust (.rs)",
        &["**/*.rs"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "Go",
        "Go (.go)",
        &["**/*.go"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "Java / Kotlin",
        "Java / Kotlin (.java, .kt)",
        &["**/*.java", "**/*.kt"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "C# / C++",
        "C# / C++ (.cs, .cpp, .c)",
        &["**/*.cs", "**/*.cpp", "**/*.c"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "Markdown",
        "Markdown (.md, .mdx)",
        &["**/*.md", "**/*.mdx"],
        "@vivantel/virage-chunker-ce-md",
    ),
    (
        "PDF",
        "PDF (.pdf)",
        &["**/*.pdf"],
        "@vivantel/virage-chunker-ce-pdf",
    ),
    (
        "Word / DOCX",
        "Word / DOCX (.docx)",
        &["**/*.docx"],
        "@vivantel/virage-chunker-ce-docx",
    ),
    (
        "LaTeX",
        "LaTeX (.tex)",
        &["**/*.tex"],
        "@vivantel/virage-chunker-ce-latex",
    ),
];

fn cmd_init(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    use dialoguer::{MultiSelect, Select};

    out.section("Virage Setup");
    out.dim("Use ← Back to return to the previous step.");
    println!();

    const BACK: &str = "← Back";

    // Wizard state
    let default_config = if config.is_empty() {
        "virage.config.json".to_string()
    } else {
        config.to_string()
    };
    let cwd = std::env::current_dir()?;
    let mut config_path = default_config.clone();
    let mut selected_type_indices: Vec<usize> = vec![];
    let mut selected_agents: Vec<&str> = vec!["claude-code"];
    let mut embedder_pkg = "@vivantel/virage-embedder-onnx";
    let mut store_pkg = "@vivantel/virage-store-lancedb";
    let source_pkg = "@vivantel/virage-source-git"; // default, no prompt (H2)
    let mut reranker_pkg: Option<&str> = None;
    let mut use_hybrid = false;
    let mut hybrid_alpha: f32 = 0.6;
    let mut install_scope = "local";

    let mut step = 0usize;

    loop {
        match step {
            // ── Step 0: Config path (H1: Select instead of Input) ─────────────
            0 => {
                let config_exists = std::path::Path::new(&config_path).exists();
                let choices = if config_exists {
                    vec![
                        BACK,
                        "Use default path (overwrite existing)",
                        "Enter custom path",
                        "← Exit",
                    ]
                } else {
                    vec![BACK, "Use default path", "Enter custom path", "← Exit"]
                };
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt(format!("Config path (default: {default_config})"))
                    .items(&choices)
                    .default(1)
                    .interact()?;
                match idx {
                    0 | 3 => {
                        out.info("Cancelled.");
                        std::process::exit(0);
                    }
                    2 => {
                        config_path = dialoguer::Input::with_theme(&virage_theme())
                            .with_prompt("Config file path")
                            .default(default_config.clone())
                            .interact_text()?;
                    }
                    _ => {
                        config_path = default_config.clone();
                    }
                }
                step += 1;
            }

            // ── Step 1: File type detection + multiselect (H2: use CWD) ───────
            1 => {
                let pb = spinner("Detecting file types...");
                let counts = detect_file_types(&cwd);
                pb.finish_and_clear();

                let content_labels: Vec<String> = FILE_TYPE_META
                    .iter()
                    .map(|(key, label, _, _)| {
                        if let Some(n) = counts.get(*key) {
                            format!("{label} [{n} files]")
                        } else {
                            label.to_string()
                        }
                    })
                    .collect();
                let mut selections: Vec<bool> = FILE_TYPE_META
                    .iter()
                    .map(|(key, _, _, _)| counts.contains_key(*key))
                    .collect();

                const CTRL_SELECT_ALL: usize = 0;
                const CTRL_INVERT: usize = 1;
                const CTRL_OFFSET: usize = 2;

                loop {
                    let items: Vec<String> = ["✓ Select all", "⟳ Invert selection"]
                        .iter()
                        .map(|s| s.to_string())
                        .chain(content_labels.iter().cloned())
                        .collect();
                    let defaults: Vec<bool> = [false, false]
                        .iter()
                        .copied()
                        .chain(selections.iter().copied())
                        .collect();

                    let picked = MultiSelect::with_theme(&virage_theme())
                        .with_prompt("File types to index · Space: toggle  ·  Enter: confirm")
                        .items(&items)
                        .defaults(&defaults)
                        .interact()?;

                    if picked.contains(&CTRL_SELECT_ALL) {
                        selections.fill(true);
                        continue;
                    }
                    if picked.contains(&CTRL_INVERT) {
                        for s in &mut selections {
                            *s = !*s;
                        }
                        continue;
                    }
                    for (i, s) in selections.iter_mut().enumerate() {
                        *s = picked.contains(&(i + CTRL_OFFSET));
                    }
                    break;
                }

                if !selections.iter().any(|&s| s) {
                    out.warn("Select at least one file type.");
                    continue;
                }

                let nav = Select::with_theme(&virage_theme())
                    .with_prompt("")
                    .items(&["→ Continue", "← Back"])
                    .default(0)
                    .interact()?;
                if nav == 1 {
                    step = step.saturating_sub(1);
                    continue;
                }

                selected_type_indices = selections
                    .iter()
                    .enumerate()
                    .filter_map(|(i, &s)| if s { Some(i) } else { None })
                    .collect();
                step += 1;
            }

            // ── Step 2: Coding agents (H3) ────────────────────────────────────
            2 => {
                let agent_labels = [
                    "Claude Code (claude-code)",
                    "GitHub Copilot (copilot)",
                    "OpenAI Codex (codex)",
                    "Antigravity",
                ];
                let agent_keys = ["claude-code", "copilot", "codex", "antigravity"];
                let mut selections: Vec<bool> = vec![true, false, false, false];

                const CTRL_SELECT_ALL: usize = 0;
                const CTRL_INVERT: usize = 1;
                const CTRL_OFFSET: usize = 2;

                loop {
                    let items: Vec<String> = ["✓ Select all", "⟳ Invert selection"]
                        .iter()
                        .map(|s| s.to_string())
                        .chain(agent_labels.iter().map(|s| s.to_string()))
                        .collect();
                    let defaults: Vec<bool> = [false, false]
                        .iter()
                        .copied()
                        .chain(selections.iter().copied())
                        .collect();

                    let picked = MultiSelect::with_theme(&virage_theme())
                        .with_prompt("Coding agents to support · Space: toggle  ·  Enter: confirm")
                        .items(&items)
                        .defaults(&defaults)
                        .interact()?;

                    if picked.contains(&CTRL_SELECT_ALL) {
                        selections.fill(true);
                        continue;
                    }
                    if picked.contains(&CTRL_INVERT) {
                        for s in &mut selections {
                            *s = !*s;
                        }
                        continue;
                    }
                    for (i, s) in selections.iter_mut().enumerate() {
                        *s = picked.contains(&(i + CTRL_OFFSET));
                    }
                    break;
                }

                selected_agents = agent_keys
                    .iter()
                    .enumerate()
                    .filter_map(|(i, &k)| if selections[i] { Some(k) } else { None })
                    .collect();

                let nav = Select::with_theme(&virage_theme())
                    .with_prompt("")
                    .items(&["→ Continue", "← Back"])
                    .default(0)
                    .interact()?;
                if nav == 1 {
                    step = step.saturating_sub(1);
                    continue;
                }
                step += 1;
            }

            // ── Step 3: Embedder ──────────────────────────────────────────────
            3 => {
                let choices = [
                    BACK,
                    "ONNX (local, no API key needed)",
                    "OpenAI text-embedding-3-small",
                    "Cohere embed-english-v3",
                    "FastEmbed (Qdrant, local)",
                ];
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt("Embedder")
                    .items(&choices)
                    .default(1)
                    .interact()?;
                match idx {
                    0 => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    2 => embedder_pkg = "@vivantel/virage-embedder-openai",
                    3 => embedder_pkg = "@vivantel/virage-embedder-cohere",
                    4 => embedder_pkg = "@vivantel/virage-embedder-fastembed",
                    _ => embedder_pkg = "@vivantel/virage-embedder-onnx",
                }
                step += 1;
            }

            // ── Step 4: Vector store ──────────────────────────────────────────
            4 => {
                let choices = [
                    BACK,
                    "LanceDB (local, file-based)",
                    "Qdrant (self-hosted or cloud)",
                    "PostgreSQL + pgvector",
                    "ChromaDB",
                ];
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt("Vector store")
                    .items(&choices)
                    .default(1)
                    .interact()?;
                match idx {
                    0 => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    2 => store_pkg = "@vivantel/virage-store-qdrant",
                    3 => store_pkg = "@vivantel/virage-store-postgres",
                    4 => store_pkg = "@vivantel/virage-store-chromadb",
                    _ => store_pkg = "@vivantel/virage-store-lancedb",
                }
                step += 1;
            }

            // ── Step 5: Reranker ──────────────────────────────────────────────
            5 => {
                let choices = [
                    BACK,
                    "None (skip, use vector similarity only)",
                    "ONNX cross-encoder (local, improves precision)",
                    "LLM re-ranker — Anthropic API (claude-haiku-4-5)",
                ];
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt("Reranker")
                    .items(&choices)
                    .default(1)
                    .interact()?;
                match idx {
                    0 => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    2 => reranker_pkg = Some("@vivantel/virage-reranker-cross-encoder"),
                    3 => reranker_pkg = Some("@vivantel/virage-reranker-llm"),
                    _ => reranker_pkg = None,
                }
                step += 1;
            }

            // ── Step 6: Hybrid search (unconditional — G7) ───────────────────
            6 => {
                let choices = [BACK, "Yes — enable hybrid (dense + sparse BM25)", "No"];
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt("Enable hybrid search?")
                    .items(&choices)
                    .default(1)
                    .interact()?;
                match idx {
                    0 => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    2 => {
                        use_hybrid = false;
                        step += 1;
                        continue;
                    }
                    _ => {}
                }
                use_hybrid = true;

                // G8: alpha sub-select
                let alpha_choices = [
                    BACK,
                    "0.6 (default — balanced)",
                    "0.3 (sparse-heavy)",
                    "0.8 (dense-heavy)",
                    "Custom",
                ];
                loop {
                    let aidx = Select::with_theme(&virage_theme())
                        .with_prompt("Hybrid alpha (0 = sparse only, 1 = dense only)")
                        .items(&alpha_choices)
                        .default(1)
                        .interact()?;
                    match aidx {
                        0 => {
                            use_hybrid = false;
                            break;
                        }
                        2 => {
                            hybrid_alpha = 0.3;
                            break;
                        }
                        3 => {
                            hybrid_alpha = 0.8;
                            break;
                        }
                        4 => {
                            let raw: String = dialoguer::Input::with_theme(&virage_theme())
                                .with_prompt("Alpha (0.0–1.0)")
                                .interact_text()?;
                            match raw.parse::<f32>() {
                                Ok(v) if (0.0..=1.0).contains(&v) => {
                                    hybrid_alpha = v;
                                    break;
                                }
                                _ => {
                                    out.warn("Enter a number between 0.0 and 1.0.");
                                }
                            }
                        }
                        _ => {
                            hybrid_alpha = 0.6;
                            break;
                        }
                    }
                }
                step += 1;
            }

            // ── Step 7: Install scope (H5) ───────────────────────────────────
            7 => {
                let choices = [BACK, "Local (this project)", "Global (all projects)"];
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt("Install scope")
                    .items(&choices)
                    .default(1)
                    .interact()?;
                match idx {
                    0 => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    2 => install_scope = "global",
                    _ => install_scope = "local",
                }
                step += 1;
            }

            // ── Step 8: Summary + confirm ─────────────────────────────────────
            8 => {
                let type_names: Vec<&str> = selected_type_indices
                    .iter()
                    .map(|&i| FILE_TYPE_META[i].1)
                    .collect();

                out.section("Summary");
                // H12: formatted summary box
                let summary = format_wizard_summary(
                    &config_path,
                    &type_names,
                    &selected_agents,
                    embedder_pkg,
                    store_pkg,
                    reranker_pkg,
                    use_hybrid,
                    hybrid_alpha,
                    install_scope,
                );
                println!("{summary}");
                println!();

                let choices = [BACK, "Write config", "Cancel"];
                let idx = Select::with_theme(&virage_theme())
                    .with_prompt("Confirm")
                    .items(&choices)
                    .default(1)
                    .interact()?;
                match idx {
                    0 => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    2 => {
                        out.info("Cancelled.");
                        return Ok(());
                    }
                    _ => {}
                }
                break;
            }

            _ => break,
        }
    }

    // ── Build config ──────────────────────────────────────────────────────────
    // Group selected types by chunker package → one fileSet per chunker.
    let mut chunker_groups: std::collections::BTreeMap<&str, (Vec<&str>, Vec<&str>)> =
        std::collections::BTreeMap::new();
    for &i in &selected_type_indices {
        let (_, _, patterns, chunker) = FILE_TYPE_META[i];
        let entry = chunker_groups.entry(chunker).or_default();
        entry.0.extend_from_slice(patterns);
        entry.1.push(FILE_TYPE_META[i].0);
    }

    let mut file_sets = Vec::new();
    for (chunker, (patterns, type_names)) in &chunker_groups {
        let set_name = if type_names.len() == 1 {
            type_names[0].to_lowercase().replace(" / ", "-")
        } else {
            "code".to_string()
        };
        // G2: emit builtin key + G3 chunker options
        let chunker_spec = if let Some(builtin) = package_to_builtin(chunker) {
            let options = chunker_options_for(builtin);
            if options.is_null() {
                serde_json::json!({ "builtin": builtin })
            } else {
                serde_json::json!({ "builtin": builtin, "options": options })
            }
        } else {
            serde_json::json!({ "package": chunker })
        };
        file_sets.push(serde_json::json!({
            "name": set_name,
            "source": "default",
            "include": patterns,
            "chunkers": [chunker_spec]
        }));
    }

    // G2/G4: embedder with builtin key and default options
    let embedder_spec = if let Some(builtin) = package_to_builtin(embedder_pkg) {
        let opts = embedder_options_for(builtin);
        serde_json::json!({ "builtin": builtin, "options": opts })
    } else {
        let opts = embedder_options_for(embedder_pkg);
        serde_json::json!({ "package": embedder_pkg, "options": opts })
    };

    // G2/G5: vectorStore with builtin key and default options
    let store_spec = if let Some(builtin) = package_to_builtin(store_pkg) {
        let opts = store_options_for(builtin);
        serde_json::json!({ "builtin": builtin, "options": opts })
    } else {
        serde_json::json!({ "package": store_pkg })
    };

    // v2: source goes in top-level "sources" map; filesets reference it by name
    let source_spec = if let Some(builtin) = package_to_builtin(source_pkg) {
        serde_json::json!({ "builtin": builtin })
    } else {
        serde_json::json!({ "package": source_pkg })
    };

    let mut providers = serde_json::json!({
        "embedder": embedder_spec,
        "vectorStore": store_spec
    });

    // G2/G6: reranker with builtin key and default options
    if let Some(r) = reranker_pkg {
        let reranker_spec = if let Some(builtin) = package_to_builtin(r) {
            let opts = reranker_options_for(builtin);
            serde_json::json!({ "builtin": builtin, "options": opts })
        } else {
            serde_json::json!({ "package": r })
        };
        providers["reranker"] = reranker_spec;
    }

    // H7: default ignore patterns
    let mut ignore_patterns = vec![
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/build/**",
        "**/.virage/**",
        "**/target/**",
        "**/__pycache__/**",
        "**/.next/**",
        "**/vendor/**",
    ];
    // Add language-specific ignore patterns
    let java_kotlin_selected = selected_type_indices
        .iter()
        .any(|&i| FILE_TYPE_META[i].0 == "Java / Kotlin");
    let csharp_selected = selected_type_indices
        .iter()
        .any(|&i| FILE_TYPE_META[i].0 == "C# / C++");
    if java_kotlin_selected {
        ignore_patterns.push("**/target/**");
        ignore_patterns.push("**/*.class");
    }
    if csharp_selected {
        ignore_patterns.push("**/bin/**");
        ignore_patterns.push("**/obj/**");
    }
    ignore_patterns.dedup();

    // G9: hybrid goes in "search" section, not "pipeline"
    // H6: fixed $schema URL (already set above)
    let mut cfg = serde_json::json!({
        "$schema": "https://unpkg.com/@vivantel/virage-core/schemas/virage.config.schema.json",
        "version": "2",
        "sources": {
            "default": source_spec
        },
        "providers": providers,
        "fileSets": file_sets,
        "ignore": ignore_patterns,
        "agents": selected_agents,
        "installScope": install_scope,
        "telemetry": {
            "enabled": true,
            "endpoint": "https://telemetry.vivantel.com",
            "tiers": { "implicit": true }
        }
    });

    if use_hybrid {
        cfg["search"] = serde_json::json!({
            "hybrid": true,
            "hybridAlpha": hybrid_alpha
        });
    }

    // H11: rotate existing backup slots before writing
    rotate_config_backup(std::path::Path::new(&config_path))?;
    std::fs::write(&config_path, serde_json::to_string_pretty(&cfg)?)?;
    println!();
    out.success(&format!("Config written to {config_path}"));

    // H13: Next steps
    println!();
    out.info("Next steps:");
    out.info("  1. Run `virage validate` to check the config");
    out.info("  2. Run `virage index` to build the search index");
    if store_pkg.contains("qdrant") {
        out.dim("     Note: Qdrant requires a running server. Start with: docker run -p 6333:6333 qdrant/qdrant");
    }
    Ok(())
}

// G3: chunker default options per builtin key
fn chunker_options_for(builtin: &str) -> serde_json::Value {
    match builtin {
        "lang" => serde_json::json!({ "maxTokens": 512 }),
        "pdf" | "docx" | "latex" => {
            serde_json::json!({ "maxTokens": 512, "overlapSentences": 1 })
        }
        _ => serde_json::Value::Null,
    }
}

// G4: embedder default options per builtin key or package name
fn embedder_options_for(key: &str) -> serde_json::Value {
    match key {
        "onnx" => serde_json::json!({ "model": "Xenova/all-MiniLM-L6-v2", "dimensions": 384 }),
        "fastembed" => {
            serde_json::json!({ "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 })
        }
        "@vivantel/virage-embedder-openai" => {
            serde_json::json!({ "model": "text-embedding-3-small", "dimensions": 1536 })
        }
        "@vivantel/virage-embedder-cohere" => {
            serde_json::json!({ "model": "embed-english-v3.0", "dimensions": 1024 })
        }
        _ => serde_json::json!({}),
    }
}

// G5: vector store default options per builtin key
fn store_options_for(builtin: &str) -> serde_json::Value {
    match builtin {
        "lancedb" => serde_json::json!({ "uri": ".virage/lancedb" }),
        "qdrant" => {
            serde_json::json!({ "url": "http://localhost:6333", "collectionName": "virage" })
        }
        "postgres" => {
            serde_json::json!({ "connectionString": "postgresql://localhost/virage" })
        }
        "chromadb" => {
            serde_json::json!({ "url": "http://localhost:8000", "collectionName": "virage" })
        }
        _ => serde_json::json!({}),
    }
}

// G6: reranker default options per builtin key
fn reranker_options_for(builtin: &str) -> serde_json::Value {
    match builtin {
        "cross-encoder" => {
            serde_json::json!({
                "model": "cross-encoder/ms-marco-MiniLM-L-12-v2",
                "topK": 5
            })
        }
        "llm" => serde_json::json!({ "model": "claude-haiku-4-5", "topK": 5 }),
        _ => serde_json::json!({}),
    }
}

// H11: rotate .bak.N slots (max 5) before overwriting a config file
fn rotate_config_backup(path: &std::path::Path) -> anyhow::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    // Shift .bak.4 → .bak.5 … .bak.1 → .bak.2, then copy current → .bak.1
    for n in (1u8..5).rev() {
        let src = path.with_extension(format!("json.bak.{n}"));
        let dst = path.with_extension(format!("json.bak.{}", n + 1));
        if src.exists() {
            let _ = std::fs::rename(&src, &dst);
        }
    }
    let bak1 = path.with_extension("json.bak.1");
    std::fs::copy(path, &bak1)?;
    Ok(())
}

// H12: produce a ╔═...═╗ summary box with all wizard selections
fn format_wizard_summary(
    config_path: &str,
    type_names: &[&str],
    selected_agents: &[&str],
    embedder_pkg: &str,
    store_pkg: &str,
    reranker_pkg: Option<&str>,
    use_hybrid: bool,
    hybrid_alpha: f32,
    install_scope: &str,
) -> String {
    use console::style;

    let embedder_short = embedder_pkg.split('/').last().unwrap_or(embedder_pkg);
    let store_short = store_pkg.split('/').last().unwrap_or(store_pkg);

    let reranker_line = match reranker_pkg {
        Some(pkg) => pkg.split('/').last().unwrap_or(pkg).to_string(),
        None => "none".to_string(),
    };
    let hybrid_line = if use_hybrid {
        format!("yes  (α = {hybrid_alpha:.2})")
    } else {
        "no".to_string()
    };

    let types_line = if type_names.is_empty() {
        "(none)".to_string()
    } else {
        type_names.join(", ")
    };
    let agents_line = if selected_agents.is_empty() {
        "(none)".to_string()
    } else {
        selected_agents.join(", ")
    };

    let rows: &[(&str, String)] = &[
        ("Config", config_path.to_string()),
        ("File types", types_line),
        ("Agents", agents_line),
        ("Embedder", embedder_short.to_string()),
        ("Vector store", store_short.to_string()),
        ("Reranker", reranker_line),
        ("Hybrid search", hybrid_line),
        ("Install scope", install_scope.to_string()),
    ];

    let label_w = rows.iter().map(|(k, _)| k.len()).max().unwrap_or(0);
    let value_w = rows.iter().map(|(_, v)| v.len()).max().unwrap_or(0);
    let inner_w = label_w + 3 + value_w; // "  label  :  value"

    let top = format!("╔{}╗", "═".repeat(inner_w + 2));
    let bot = format!("╚{}╝", "═".repeat(inner_w + 2));

    let mut lines = vec![style(top).cyan().to_string()];
    for (k, v) in rows {
        let label = format!("{k:>label_w$}");
        let row = format!("║ {label}  :  {v:<value_w$} ║");
        lines.push(style(row).cyan().to_string());
    }
    lines.push(style(bot).cyan().to_string());
    lines.join("\n")
}

// ─── update ──────────────────────────────────────────────────────────────────

fn cmd_update(verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    use console::style;
    use dialoguer::MultiSelect;

    let npm = npm_bin();
    let cwd = std::env::current_dir()?;

    out.section("Virage Update");

    // ── 1. Discover packages ──────────────────────────────────────────────────
    let config_path = find_config().unwrap_or_else(|| "virage.config.json".into());
    let packages = discover_virage_packages(&cwd, &config_path);

    if packages.is_empty() {
        out.warn("No @vivantel/* packages found.");
        return Ok(());
    }

    // ── 2. Check versions ─────────────────────────────────────────────────────
    let pb = spinner("Checking versions...");
    let mut statuses: Vec<PackageStatus> = Vec::new();
    for pkg in &packages {
        pb.set_message(format!("Checking {pkg}..."));
        let current = get_npm_current(npm, pkg, &cwd).unwrap_or_else(|| "not installed".into());
        let latest = get_npm_latest(npm, pkg).unwrap_or_else(|| "unknown".into());
        let outdated = latest != "unknown" && current != "not installed" && current != latest;
        statuses.push(PackageStatus {
            name: pkg.clone(),
            current,
            latest,
            outdated,
        });
    }
    pb.finish_and_clear();

    // ── 3. Display status table ───────────────────────────────────────────────
    println!();
    for s in &statuses {
        let cur_styled = if s.outdated {
            style(&s.current).yellow().to_string()
        } else if s.current == "not installed" {
            style(&s.current).dim().to_string()
        } else {
            style(&s.current).green().to_string()
        };
        let lat_styled = if s.outdated {
            style(&s.latest).green().to_string()
        } else {
            style(&s.latest).dim().to_string()
        };
        println!(
            "  {:45}  {}  →  {}",
            style(&s.name).dim(),
            cur_styled,
            lat_styled
        );
    }
    println!();

    // ── 4. Interactive selection ──────────────────────────────────────────────
    let labels: Vec<String> = statuses
        .iter()
        .map(|s| {
            if s.outdated {
                format!("{} ({} → {})", s.name, s.current, s.latest)
            } else {
                format!("{} ({})", s.name, s.current)
            }
        })
        .collect();

    let defaults: Vec<bool> = statuses.iter().map(|s| s.outdated).collect();

    let selected = MultiSelect::with_theme(&virage_theme())
        .with_prompt("Packages to update (Space = toggle · a = select all · Enter = confirm)")
        .items(&labels)
        .defaults(&defaults)
        .interact()?;

    if selected.is_empty() {
        out.info("Nothing selected.");
        return Ok(());
    }

    // ── 5. Install selected packages — I1: single batched npm install -g call ──
    let to_install: Vec<&str> = selected
        .iter()
        .map(|&i| statuses[i].name.as_str())
        .collect();
    out.info(&format!("Installing {} package(s)...", to_install.len()));

    let pkg_args: Vec<String> = to_install.iter().map(|p| format!("{p}@latest")).collect();
    out.dim(&format!("  npm install -g {}", pkg_args.join(" ")));
    let status = std::process::Command::new(npm)
        .arg("install")
        .arg("-g")
        .args(&pkg_args)
        .status();
    match status {
        Ok(s) if s.success() => out.success(&format!("{} package(s) updated", to_install.len())),
        Ok(s) => out.warn(&format!("npm exited with status {s}")),
        Err(e) => out.error(&format!("npm install failed: {e}")),
    }

    // ── 6. Self-update (virage CLI binary) ────────────────────────────────────
    out.dim("Checking virage binary...");
    let self_current =
        get_npm_current(npm, "@vivantel/virage", &cwd).unwrap_or_else(|| "unknown".into());
    let self_latest = get_npm_latest(npm, "@vivantel/virage").unwrap_or_else(|| "unknown".into());

    if self_latest != "unknown" && self_current != self_latest {
        out.info(&format!(
            "Updating virage binary {self_current} → {self_latest}..."
        ));
        let status = std::process::Command::new(npm)
            .args(["install", "-g", "@vivantel/virage@latest"])
            .status();
        match status {
            Ok(s) if s.success() => out.success("virage binary updated."),
            Ok(s) => out.warn(&format!("virage binary update exited {s}")),
            Err(e) => out.error(&format!("virage binary update failed: {e}")),
        }
    } else {
        out.dim("virage binary is up to date.");
    }

    out.success("Update complete.");
    Ok(())
}

// ─── pack ────────────────────────────────────────────────────────────────────

fn cmd_pack(args: PackArgs, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    use flate2::{write::GzEncoder, Compression};
    let out = Out::new(verbose, format);

    let virage_dir = PathBuf::from(".virage");
    if !virage_dir.exists() {
        return Err(anyhow::anyhow!(
            ".virage/ not found — run `virage index` first"
        ));
    }

    let out_path = PathBuf::from(&args.output);
    let file = std::fs::File::create(&out_path)
        .map_err(|e| anyhow::anyhow!("Cannot create {:?}: {e}", out_path))?;
    let enc = GzEncoder::new(file, Compression::default());
    let mut archive = tar::Builder::new(enc);
    archive.append_dir_all(".virage", &virage_dir)?;
    archive.finish()?;

    let size = std::fs::metadata(&out_path)?.len();
    out.success(&format!(
        "Archive created: {} ({} KB)",
        args.output,
        size / 1024
    ));
    Ok(())
}

// ─── uninstall ───────────────────────────────────────────────────────────────

fn cmd_uninstall(verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    use dialoguer::Confirm;

    out.section("Virage Uninstall");

    let hooks_dir = PathBuf::from(".git/hooks");
    if hooks_dir.exists() {
        for hook in &["post-merge", "post-checkout"] {
            let p = hooks_dir.join(hook);
            if p.exists()
                && Confirm::with_theme(&virage_theme())
                    .with_prompt(format!("Remove git hook {hook}?"))
                    .default(false)
                    .interact()?
            {
                std::fs::remove_file(&p)?;
                out.success(&format!("Removed: {}", p.display()));
            }
        }
    }

    let virage_dir = PathBuf::from(".virage");
    if virage_dir.exists()
        && Confirm::with_theme(&virage_theme())
            .with_prompt("Remove .virage/ (index DB)?")
            .default(false)
            .interact()?
    {
        std::fs::remove_dir_all(&virage_dir)?;
        out.success("Removed: .virage/");
    }

    let config = PathBuf::from("virage.config.json");
    if config.exists()
        && Confirm::with_theme(&virage_theme())
            .with_prompt("Remove virage.config.json?")
            .default(false)
            .interact()?
    {
        std::fs::remove_file(&config)?;
        out.success("Removed: virage.config.json");
    }

    out.success("Uninstall complete.");
    Ok(())
}

// ─── dashboard ───────────────────────────────────────────────────────────────

fn cmd_dashboard(
    args: DashboardArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let db_path = resolve_db_path(&args.db);
    let mut cmd = std::process::Command::new("npx");
    cmd.args([
        "@vivantel/virage-dashboard",
        "--port",
        &args.port.to_string(),
        "--db",
        &db_path,
    ]);
    if !config.is_empty() {
        cmd.args(["--config", config]);
    }
    out.info(&format!(
        "Starting dashboard on http://localhost:{} ...",
        args.port
    ));
    out.dim("Requires Node.js — install with: npm install -g @vivantel/virage-dashboard");
    let status = cmd.status().map_err(|e| {
        anyhow::anyhow!("Failed to launch dashboard: {e}\nEnsure Node.js is installed.")
    })?;
    if !status.success() {
        anyhow::bail!("dashboard exited with status {status}");
    }
    Ok(())
}

async fn cmd_serve(config: &str) -> anyhow::Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let config_path = resolve_config_path(config)?;
    let cfg = load_config(&config_path)?;
    let dims = embedder_dims(&cfg);
    let db_path = default_db_path();

    let embedder = resolve_embedder(&cfg.providers.embedder)?;
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;

    let mut reader = BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();
    let mut line = String::new();

    eprintln!(
        "[virage] MCP stdio server v{} ready.",
        env!("CARGO_PKG_VERSION")
    );

    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let request: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        // JSON-RPC 2.0: notifications (no "id") don't get responses.
        let Some(id) = request.get("id").cloned() else {
            continue;
        };
        let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let result: Result<serde_json::Value, serde_json::Value> = match method {
            "initialize" => Ok(serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "virage", "version": env!("CARGO_PKG_VERSION") }
            })),
            "tools/list" => Ok(mcp_tools_list()),
            "tools/call" => {
                let name = request
                    .pointer("/params/name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let call_args = request
                    .pointer("/params/arguments")
                    .cloned()
                    .unwrap_or_default();
                mcp_tool_call(&name, &call_args, &embedder, &store, &db_path).await
            }
            _ => Err(serde_json::json!({"code": -32601, "message": "Method not found"})),
        };
        let response = match result {
            Ok(r) => serde_json::json!({"jsonrpc":"2.0","id":id,"result":r}),
            Err(e) => serde_json::json!({"jsonrpc":"2.0","id":id,"error":e}),
        };
        let mut s = serde_json::to_string(&response)?;
        s.push('\n');
        stdout.write_all(s.as_bytes()).await?;
        stdout.flush().await?;
    }
    Ok(())
}

fn mcp_tools_list() -> serde_json::Value {
    serde_json::json!({
        "tools": [
            {
                "name": "search_chunks",
                "description": "Semantic search over indexed source files and documents.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Natural-language search query."
                        },
                        "top_k": {
                            "type": "integer",
                            "description": "Max results to return (default 5)."
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "browse_chunks",
                "description": "List indexed source files and their revision hashes.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "filter": {
                            "type": "string",
                            "description": "Optional path substring filter."
                        }
                    }
                }
            },
            {
                "name": "get_stats",
                "description": "Return index statistics: file count and vector store info.",
                "inputSchema": { "type": "object", "properties": {} }
            }
        ]
    })
}

async fn mcp_tool_call(
    name: &str,
    args: &serde_json::Value,
    embedder: &Arc<std::sync::Mutex<dyn Embedder + Send>>,
    store: &Arc<dyn VectorStore>,
    db_path: &str,
) -> Result<serde_json::Value, serde_json::Value> {
    match name {
        "search_chunks" => {
            let query = args["query"].as_str().unwrap_or_default().to_string();
            if query.is_empty() {
                return Err(serde_json::json!({"code":-32602,"message":"query is required"}));
            }
            let top_k = args["top_k"].as_u64().unwrap_or(5) as usize;
            let vec = embedder
                .lock()
                .map_err(|_| serde_json::json!({"code":-32603,"message":"embedder lock poisoned"}))?
                .embed_batch(std::slice::from_ref(&query))
                .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?;
            let opts = SearchOptions {
                filter: None,
                tag_filter: None,
                hybrid: false,
                hybrid_alpha: 0.6,
                query_text: None,
            };
            let results = store
                .search(&vec, top_k, opts)
                .await
                .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?;
            let text = if results.is_empty() {
                "No results found.".to_string()
            } else {
                results
                    .iter()
                    .enumerate()
                    .map(|(i, r)| {
                        let src = r.source_file.as_deref().unwrap_or("unknown");
                        let snippet = if r.dense_text.len() > 500 {
                            format!("{}…", &r.dense_text[..500])
                        } else {
                            r.dense_text.clone()
                        };
                        format!(
                            "[{}] {}  (similarity: {:.1}%)\n{}",
                            i + 1,
                            src,
                            r.similarity * 100.0,
                            snippet
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n---\n")
            };
            Ok(serde_json::json!({"content":[{"type":"text","text":text}]}))
        }
        "browse_chunks" => {
            let filter = args["filter"].as_str().map(str::to_lowercase);
            let path = db_path.to_string();
            let revisions = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
                let db = open_or_init_db(&path)?;
                db.get_file_revisions()
                    .map_err(|e| anyhow::anyhow!("DB error: {e}"))
            })
            .await
            .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?
            .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?;
            let mut files: Vec<_> = revisions
                .iter()
                .filter(|(k, _)| {
                    filter
                        .as_ref()
                        .is_none_or(|f| k.to_lowercase().contains(f.as_str()))
                })
                .collect();
            files.sort_by_key(|(k, _)| k.as_str());
            let text = if files.is_empty() {
                "No indexed files found.".to_string()
            } else {
                files
                    .iter()
                    .map(|(p, rev)| format!("{p}  [{}]", &rev[..rev.len().min(8)]))
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            Ok(serde_json::json!({"content":[{"type":"text","text":text}]}))
        }
        "get_stats" => {
            let path = db_path.to_string();
            let file_count = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
                let db = open_or_init_db(&path)?;
                db.get_file_revisions()
                    .map(|m| m.len())
                    .map_err(|e| anyhow::anyhow!("DB error: {e}"))
            })
            .await
            .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?
            .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?;
            let store_state = store
                .current_state()
                .await
                .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?;
            let text = format!(
                "Indexed files : {file_count}\nStore entries : {}",
                store_state.len(),
            );
            Ok(serde_json::json!({"content":[{"type":"text","text":text}]}))
        }
        _ => Err(serde_json::json!({"code":-32602,"message":format!("Unknown tool: {name}")})),
    }
}

fn cmd_plugin(args: PluginArgs, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    match args.command {
        PluginCommand::Test { path } => cmd_plugin_test(&path, verbose, format),
    }
}

fn cmd_plugin_test(path: &str, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    #[cfg(feature = "wasm-host")]
    return cmd_plugin_test_wasm(path, verbose, format);
    #[cfg(not(feature = "wasm-host"))]
    {
        let out = Out::new(verbose, format);
        out.warn("WASM host not available — rebuild with --features wasm-host.");
        Ok(())
    }
}

#[cfg(feature = "wasm-host")]
fn cmd_plugin_test_wasm(path: &str, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    use virage_engine::plugins::wasm::chunker::WasmChunkerAdapter;
    use virage_engine::plugins::wasm::{FileInfo, WasmPluginHost, WasmRegistry};
    let out = Out::new(verbose, format);

    let wasm_path = std::path::Path::new(path);
    if !wasm_path.exists() {
        return Err(anyhow::anyhow!("File not found: {path}"));
    }

    out.info(&format!("Loading plugin: {path}"));
    let host = WasmPluginHost::new()?;
    let registry = WasmRegistry::new(host);
    let adapter = WasmChunkerAdapter::from_path(&registry, wasm_path, "{}")?;

    out.dim("  init + patterns...");
    let patterns = adapter.init_and_patterns()?;
    out.verbose(&format!("  Patterns: {patterns:?}"));

    out.dim("  parse + chunk smoke test...");
    let info = FileInfo {
        path: "smoke-test.txt".to_string(),
        hash: "smoke".to_string(),
        size: 13,
        modified_ms: 0,
    };
    let doc = adapter.parse(&info, b"Hello, world.")?;
    let chunks = adapter.chunk(&doc, &info, "HEAD")?;
    out.success(&format!("Plugin test PASSED — {} chunk(s).", chunks.len()));
    Ok(())
}

fn cmd_usage(verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    out.info("Usage tracking is handled by the virage-agent-claude plugin.");
    out.dim("See: https://vivantel.com/virage/docs/telemetry");
    Ok(())
}

fn cmd_read_skill_summary(verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let skill_dirs = [".agents/skills", ".virage/skills"];
    let mut found = false;
    for dir in &skill_dirs {
        let dir_path = Path::new(dir);
        if !dir_path.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(dir_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
        {
            found = true;
            out.section(&entry.path().display().to_string());
            if let Ok(text) = std::fs::read_to_string(entry.path()) {
                for line in text.lines().take(20) {
                    out.info(line);
                }
            }
            println!();
        }
    }
    if !found {
        out.warn(&format!("No skill files found in {:?}.", skill_dirs));
    }
    Ok(())
}

fn cmd_viz(verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    out.dim("virage viz: embedding visualisation is deferred post-v2.");
    Ok(())
}

// ─── status ──────────────────────────────────────────────────────────────────

async fn cmd_status(
    _args: DbPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let mut all_ok = true;

    // 1. Config
    let (config_ok, cfg_opt) =
        match resolve_config_path(config).and_then(|p| load_config(&p).map(|c| (p, c))) {
            Ok((path, cfg)) => {
                out.info(&format!("  Config      ✓  {path}"));
                (true, Some(cfg))
            }
            Err(e) => {
                out.info(&format!("  Config      ✕  {e}"));
                all_ok = false;
                (false, None)
            }
        };

    // 2. Index DB
    let db_path = resolve_db_path("");
    let index_count = match open_or_init_db(&db_path) {
        Ok(db) => {
            let count = db.get_file_revisions().map(|m| m.len()).unwrap_or(0);
            out.info(&format!("  Index       ✓  {count} files  ({db_path})"));
            Some(count)
        }
        Err(e) => {
            out.info(&format!("  Index       ✕  {e}"));
            all_ok = false;
            None
        }
    };

    // 3. Store (150ms timeout)
    let store_status = if let Some(ref cfg) = cfg_opt {
        let dims = embedder_dims(cfg);
        match resolve_store(&cfg.providers.vector_store, dims) {
            Ok(store) => {
                let ping =
                    tokio::time::timeout(std::time::Duration::from_millis(150), store.initialize())
                        .await;
                match ping {
                    Ok(Ok(_)) => {
                        out.info(&format!(
                            "  Store       ✓  {}",
                            cfg.providers.vector_store.package
                        ));
                        true
                    }
                    Ok(Err(e)) => {
                        out.info(&format!("  Store       ✕  {e}"));
                        all_ok = false;
                        false
                    }
                    Err(_) => {
                        out.info("  Store       ✕  timeout (>150ms)");
                        all_ok = false;
                        false
                    }
                }
            }
            Err(e) => {
                out.info(&format!("  Store       ✕  {e}"));
                all_ok = false;
                false
            }
        }
    } else {
        false
    };

    // 4. Embedder
    let embedder_status = if let Some(ref cfg) = cfg_opt {
        match resolve_embedder(&cfg.providers.embedder) {
            Ok(_) => {
                out.info(&format!(
                    "  Embedder    ✓  {}",
                    cfg.providers.embedder.package
                ));
                true
            }
            Err(e) => {
                out.info(&format!("  Embedder    ✕  {e}"));
                all_ok = false;
                false
            }
        }
    } else {
        false
    };

    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "ok": all_ok,
            "config": config_ok,
            "indexedFiles": index_count,
            "store": store_status,
            "embedder": embedder_status,
        }));
    } else {
        out.section("Status");
        if all_ok {
            out.success("All checks passed.");
        } else {
            out.warn("One or more checks failed — run `virage doctor` for details.");
        }
    }

    if !all_ok {
        std::process::exit(1);
    }
    Ok(())
}

// ─── doctor ──────────────────────────────────────────────────────────────────

async fn cmd_doctor(
    _args: DbPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let mut errors = 0usize;
    let mut warnings = 0usize;

    out.section("Virage Doctor");

    // 1. Config
    match resolve_config_path(config).and_then(|p| load_config(&p).map(|c| (p, c))) {
        Err(e) => {
            out.error_hint(
                &format!("Config not found or invalid: {e}"),
                "Run `virage init` to create a config file.",
            );
            errors += 1;
        }
        Ok((path, cfg)) => {
            out.success(&format!("Config found: {path}"));

            // 2. fileSets not empty
            if cfg.file_sets.is_empty() {
                out.warn("No fileSets configured.");
                out.dim("      Fix: add at least one fileSet to virage.config.json");
                warnings += 1;
            }

            // 3. Embedder resolvable
            match resolve_embedder(&cfg.providers.embedder) {
                Ok(_) => out.success(&format!("Embedder OK: {}", cfg.providers.embedder.package)),
                Err(e) => {
                    out.error_hint(
                        &format!("Embedder unavailable: {e}"),
                        "Check the embedder package name and ensure the model is downloaded.",
                    );
                    errors += 1;
                }
            }

            // 4. Store reachable (150ms timeout)
            let dims = embedder_dims(&cfg);
            match resolve_store(&cfg.providers.vector_store, dims) {
                Err(e) => {
                    let hint = store_hint(&cfg.providers.vector_store.package)
                        .unwrap_or("Check your store configuration.");
                    out.error_hint(&format!("Store not reachable: {e}"), hint);
                    errors += 1;
                }
                Ok(store) => {
                    let ping = tokio::time::timeout(
                        std::time::Duration::from_millis(150),
                        store.initialize(),
                    )
                    .await;
                    match ping {
                        Ok(Ok(_)) => out
                            .success(&format!("Store OK: {}", cfg.providers.vector_store.package)),
                        Ok(Err(e)) => {
                            let hint = store_hint(&cfg.providers.vector_store.package)
                                .unwrap_or("Check your store configuration.");
                            out.error_hint(&format!("Store error: {e}"), hint);
                            errors += 1;
                        }
                        Err(_) => {
                            out.error("Store timed out (>150ms).");
                            out.dim("      Fix: ensure the store is running and reachable.");
                            errors += 1;
                        }
                    }
                }
            }

            // 5. Index DB
            let db_path = resolve_db_path("");
            match open_or_init_db(&db_path) {
                Ok(db) => {
                    let count = db.get_file_revisions().map(|m| m.len()).unwrap_or(0);
                    if count == 0 {
                        out.warn("Index is empty — run `virage index` to build the index.");
                        warnings += 1;
                    } else {
                        out.success(&format!("Index OK: {count} files"));
                    }
                }
                Err(e) => {
                    out.error_hint(
                        &format!("Cannot open state DB: {e}"),
                        "Run `virage index` to initialize the index.",
                    );
                    errors += 1;
                }
            }
        }
    }

    if errors == 0 && warnings == 0 {
        out.success("All checks passed.");
    } else {
        out.info(&format!("\n{errors} error(s) · {warnings} warning(s)"));
    }

    if errors > 0 {
        std::process::exit(1);
    }
    Ok(())
}

fn store_hint(package: &str) -> Option<&'static str> {
    if package.contains("qdrant") {
        Some("Start Qdrant: docker run -p 6333:6333 qdrant/qdrant")
    } else if package.contains("chromadb") {
        Some("Start ChromaDB: docker run -p 8000:8000 chromadb/chroma")
    } else if package.contains("postgres") {
        Some("Check your PostgreSQL connection string in virage.config.json")
    } else {
        None
    }
}

fn cmd_completions(shell: clap_complete::Shell) {
    use clap::CommandFactory;
    clap_complete::generate(shell, &mut Cli::command(), "virage", &mut std::io::stdout());
}

// ─── Platform helpers ─────────────────────────────────────────────────────────

fn is_legacy_windows_console() -> bool {
    #[cfg(windows)]
    {
        std::env::var_os("WT_SESSION").is_none() && std::env::var_os("TERM_PROGRAM").is_none()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn box_chars() -> (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
) {
    if is_legacy_windows_console() {
        ("+", "+", "+", "+", "-", "|")
    } else {
        ("╔", "╗", "╚", "╝", "═", "║")
    }
}

// ─── Banner ───────────────────────────────────────────────────────────────────

// J1: shows config summary (N chunkers · embedder-short · store-short) when config loads
fn print_banner() {
    use console::style;
    let _ = box_chars(); // ensure box_chars is available for future banner use
    eprintln!();
    eprintln!(
        "  {} {}",
        style("virage").bold().cyan(),
        style(env!("CARGO_PKG_VERSION")).dim()
    );

    // Try to load config for the summary line; ignore errors silently
    if let Some(config_path) = find_config() {
        if let Ok(cfg) = load_config(&config_path) {
            let chunker_count: usize = cfg.file_sets.iter().map(|fs| fs.chunkers.len()).sum();
            let embedder_short = cfg
                .providers
                .embedder
                .package
                .split('/')
                .last()
                .unwrap_or(&cfg.providers.embedder.package)
                .trim_start_matches("virage-embedder-");
            let store_short = cfg
                .providers
                .vector_store
                .package
                .split('/')
                .last()
                .unwrap_or(&cfg.providers.vector_store.package)
                .trim_start_matches("virage-store-");
            eprintln!(
                "  {}",
                style(format!(
                    "{chunker_count} chunker{} · {embedder_short} · {store_short}",
                    if chunker_count == 1 { "" } else { "s" }
                ))
                .dim()
            );
        } else {
            eprintln!("  {}", style("AI code-search indexer").dim());
        }
    } else {
        eprintln!("  {}", style("AI code-search indexer").dim());
    }
    eprintln!();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    // Apply color suppression before any output
    if cli.no_color || std::env::var_os("NO_COLOR").is_some() || !console::Term::stderr().is_term()
    {
        console::set_colors_enabled(false);
        console::set_colors_enabled_stderr(false);
    }

    let format: OutputFormat = cli.format.into();
    let config = cli.config.as_str();
    let out = Out::new(cli.verbose, format);

    if !cli.no_banner && format == OutputFormat::Human {
        print_banner();
    }

    let result = match cli.command {
        None => {
            // No subcommand → print help.
            Cli::parse_from(["virage", "--help"]);
            return;
        }
        Some(Commands::Index(args)) => cmd_index(args, cli.verbose, format, config).await,
        Some(Commands::Query(args)) => cmd_query(args, cli.verbose, format, config).await,
        Some(Commands::Validate(args)) => cmd_validate(args, cli.verbose, format, config).await,
        Some(Commands::Check(args)) => cmd_check(args, cli.verbose, format, config).await,
        Some(Commands::Report(args)) => cmd_report(args, cli.verbose, format),
        // H14: treat dialoguer Interrupted errors as clean cancellation
        Some(Commands::Init(args)) => cmd_init(args, cli.verbose, format, config).map_err(|e| {
            if e.to_string().contains("interrupted") || e.to_string().contains("Interrupted") {
                eprintln!("Cancelled.");
                std::process::exit(0);
            }
            e
        }),
        Some(Commands::Update) => cmd_update(cli.verbose, format).map_err(|e| {
            if e.to_string().contains("interrupted") || e.to_string().contains("Interrupted") {
                eprintln!("Cancelled.");
                std::process::exit(0);
            }
            e
        }),
        Some(Commands::Migrate(args)) => cmd_migrate(args, cli.verbose, format, config),
        Some(Commands::Pack(args)) => cmd_pack(args, cli.verbose, format),
        Some(Commands::InstallHooks(args)) => cmd_install_hooks(args, cli.verbose, format, config),
        Some(Commands::Uninstall) => cmd_uninstall(cli.verbose, format),
        Some(Commands::Telemetry(args)) => cmd_telemetry(args, cli.verbose, format),
        Some(Commands::Store(args)) => match args.command {
            StoreCommand::Stats(a) => cmd_store_stats(a, cli.verbose, format, config).await,
            StoreCommand::Perf(a) => cmd_store_perf(a, cli.verbose, format, config).await,
        },
        Some(Commands::Chunks(args)) => match args.command {
            ChunksCommand::Report(a) => cmd_chunks_report(a, cli.verbose, format),
        },
        Some(Commands::Serve(_args)) => cmd_serve(config).await,
        Some(Commands::Plugin(args)) => cmd_plugin(args, cli.verbose, format),
        Some(Commands::Usage) => cmd_usage(cli.verbose, format),
        Some(Commands::ReadSkillSummary) => cmd_read_skill_summary(cli.verbose, format),
        Some(Commands::Status(args)) => cmd_status(args, cli.verbose, format, config).await,
        Some(Commands::Doctor(args)) => cmd_doctor(args, cli.verbose, format, config).await,
        Some(Commands::Completions { shell }) => {
            cmd_completions(shell);
            Ok(())
        }
        Some(Commands::Dashboard(args)) => cmd_dashboard(args, cli.verbose, format, config),
        Some(Commands::Viz) => cmd_viz(cli.verbose, format),
        Some(Commands::Quality(args)) => cmd_quality(args, cli.verbose, format, config),
    };

    if let Err(e) = result {
        let msg = e.to_string();
        if let Some(hint) = error_hint_for(&msg) {
            out.error_hint(&msg, hint);
        } else {
            out.error(&msg);
        }
        std::process::exit(1);
    }
}

fn error_hint_for(msg: &str) -> Option<&'static str> {
    if msg.contains("virage.config.json")
        && (msg.contains("not found") || msg.contains("No such file"))
    {
        Some("Run `virage init` to create a config file.")
    } else if msg.contains("JSON") || msg.contains("parse error") || msg.contains("expected") {
        Some("Check virage.config.json for syntax errors. Run `virage validate` for details.")
    } else if msg.contains("embedder mismatch") || msg.contains("Dimension mismatch") {
        Some("Run `virage index --force` to rebuild with the current embedder.")
    } else if msg.contains("Connection refused") && msg.contains("6333") {
        Some("Start Qdrant: docker run -p 6333:6333 qdrant/qdrant")
    } else if msg.contains("Connection refused") && msg.contains("8000") {
        Some("Start ChromaDB: docker run -p 8000:8000 chromadb/chroma")
    } else {
        None
    }
}
