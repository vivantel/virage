use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use clap::{Args, Parser, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};
use virage_engine::output::Out;

#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
use virage_engine::config::resolve::resolve_reranker;
use virage_engine::config::resolve::{resolve_embedder, resolve_source, resolve_store};
use virage_engine::config::{default_db_path, find_config, load_config, VirageConfigJson};
use virage_engine::db::VirageDb;
use virage_engine::embedders::Embedder;
use virage_engine::pipeline::{coordinator::run_pipeline, PipelineConfig};
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

    #[command(subcommand)]
    command: Option<Commands>,
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
struct ConfigPathArg {
    /// Path to virage.config.json.
    #[arg(short, long, default_value = "")]
    config: String,
}

#[derive(Args)]
struct DbPathArg {
    /// Path to virage.db.
    #[arg(long, default_value = "")]
    db: String,
}

#[derive(Args)]
struct IndexArgs {
    /// Path to virage.config.json.
    #[arg(short, long, default_value = "")]
    config: String,
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
}

#[derive(Args)]
struct QueryArgs {
    /// The query text.
    query: String,
    /// Path to virage.config.json.
    #[arg(short, long, default_value = "")]
    config: String,
    /// Number of results to return.
    #[arg(long, default_value_t = 5)]
    top_k: usize,
    /// Output results as JSON.
    #[arg(long)]
    json: bool,
    /// Enable hybrid (dense + sparse) search.
    #[arg(long)]
    hybrid: bool,
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
    /// Path to virage.config.json.
    #[arg(short, long, default_value = "")]
    config: String,
}

#[derive(Args)]
struct QualityArgs {
    /// Path to virage.config.json.
    #[arg(short, long, default_value = "")]
    config: String,
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
    packages.insert("@vivantel/virage-core".to_string());
    packages.insert("@vivantel/virage-skills".to_string());

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

async fn cmd_index(args: IndexArgs, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    let config_path = resolve_config_path(&args.config)?;
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
    let pb = spinner("Loading embedder...");
    let embedder = resolve_embedder(&cfg.providers.embedder)?;

    pb.set_message("Connecting to vector store...");
    let store = resolve_store(&cfg.providers.vector_store, dims)?;

    pb.set_message("Opening state DB...");
    let db = open_or_init_db(&db_path)?;
    let known_revisions: HashMap<String, String> = if force {
        HashMap::new()
    } else {
        db.get_file_revisions()
            .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?
    };

    pb.set_message("Resolving source...");
    let source = resolve_source(cfg.providers.source.as_ref(), &cwd)?;
    pb.finish_and_clear();

    if args.watch {
        out.warn("--watch is not yet implemented");
        return Ok(());
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

    let pipeline_cfg = PipelineConfig {
        workers,
        upload_batch_size: cfg
            .pipeline
            .as_ref()
            .and_then(|p| p.min_upload_batch_size)
            .unwrap_or(64),
        max_tokens: 512,
        ..Default::default()
    };

    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("{spinner:.cyan} {msg} [{elapsed_precise}]")
            .unwrap()
            .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]),
    );
    pb.set_message("Indexing...");
    pb.enable_steady_tick(std::time::Duration::from_millis(80));

    let stats = run_pipeline(
        &pipeline_cfg,
        source.clone(),
        vec![],
        embedder,
        store,
        known_revisions,
    )
    .await?;

    pb.finish_and_clear();

    // ── Update state DB with new revisions ────────────────────────────────────
    // Re-query current file revisions from the source now that the pipeline is done.
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

    out.success(&format!(
        "Done.  Processed: {}  Skipped: {}  Deleted: {}  Chunks: {}",
        stats.files_processed, stats.files_skipped, stats.files_deleted, stats.chunks_upserted,
    ));
    Ok(())
}

async fn cmd_query(args: QueryArgs, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    let config_path = resolve_config_path(&args.config)?;
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

    let opts = SearchOptions {
        filter: None,
        tag_filter: None,
        hybrid: args.hybrid,
        hybrid_alpha: 0.6,
        query_text: if args.hybrid {
            Some(args.query.clone())
        } else {
            None
        },
    };

    let mut results = store.search(&vec, args.top_k, opts).await?;

    // Apply reranker if configured — re-scores and re-sorts results.
    #[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
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

    // Apply min-similarity filter (on original vector-similarity score).
    if let Some(min_sim) = args.min_similarity {
        results.retain(|r| r.similarity >= min_sim);
    }

    if args.json {
        let json: Vec<serde_json::Value> = results
            .iter()
            .map(|r| {
                serde_json::json!({
                    "denseText": r.dense_text,
                    "sourceFile": r.source_file,
                    "similarity": r.similarity,
                    "metadata": r.metadata,
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&json)?);
        return Ok(());
    }

    if results.is_empty() {
        out.warn("No results found.");
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
    Ok(())
}

fn cmd_validate(args: ConfigPathArg, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    let config_path = resolve_config_path(&args.config)?;
    out.section("Validate");
    out.dim(&format!("Config: {config_path}"));

    let cfg = load_config(&config_path)?;

    if cfg.file_sets.is_empty() {
        return Err(anyhow::anyhow!("fileSets must have at least one entry"));
    }

    let mut warnings = 0usize;

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
        }
        for pat in &fs.include {
            match globset::Glob::new(pat) {
                Ok(_) => out.verbose(&format!("fileSet {:?}: pattern {:?} OK", fs.name, pat)),
                Err(e) => {
                    out.warn(&format!(
                        "fileSet {:?}: invalid pattern {:?}: {e}",
                        fs.name, pat
                    ));
                    warnings += 1;
                }
            }
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

    if warnings > 0 {
        out.warn(&format!("Config loaded with {warnings} warning(s)."));
    } else {
        out.success("Config is valid.");
    }
    Ok(())
}

async fn cmd_check(args: ConfigPathArg, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    let config_path = resolve_config_path(&args.config)?;
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
    out.success("Status: OK");
    Ok(())
}

fn cmd_report(args: DbPathArg, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
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

    out.section("Virage Report");
    out.info(&format!("DB path          : {db_path}"));
    out.info(&format!("Indexed files    : {}", revisions.len()));
    out.info(&format!("Pending embed    : {pending_embed}"));
    out.info(&format!("Pending upload   : {pending_upload}"));
    Ok(())
}

fn cmd_chunks_report(args: DbPathArg, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
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

async fn cmd_store_stats(args: ConfigPathArg, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    let config_path = resolve_config_path(&args.config)?;
    let cfg = load_config(&config_path)?;
    let dims = embedder_dims(&cfg);

    let pb = spinner("Connecting to vector store...");
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;
    pb.finish_and_clear();

    let state = store.current_state().await?;
    out.section("Store Stats");
    out.info(&format!(
        "Package       : {}",
        cfg.providers.vector_store.package
    ));
    out.info(&format!("Indexed files : {}", state.len()));
    out.info(&format!("Dimensions    : {dims}"));
    Ok(())
}

async fn cmd_store_perf(args: ConfigPathArg, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    let config_path = resolve_config_path(&args.config)?;
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

    out.info(&format!("  p50 : {p50:.1}ms"));
    out.info(&format!("  p95 : {p95:.1}ms"));
    out.info(&format!("  p99 : {p99:.1}ms"));
    out.info(&format!("  QPS : {qps:.0}  (sequential, {N} queries)"));
    Ok(())
}

fn cmd_migrate(args: ConfigPathArg, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    let config_path = resolve_config_path(&args.config)?;
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

fn cmd_install_hooks(args: ConfigPathArg, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    let config_path =
        resolve_config_path(&args.config).unwrap_or_else(|_| "virage.config.json".into());
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

fn cmd_telemetry(args: TelemetryArgs, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let config_dir = PathBuf::from(home).join(".config").join("virage");
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
            out.dim("No pending telemetry events.");
        }
        TelemetryCommand::Flush => {
            out.dim("No events to flush.");
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
                let idx = Select::new()
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
                let url: String = Input::new()
                    .with_prompt("Endpoint URL")
                    .default(endpoint.clone())
                    .interact_text()?;
                let key: String = Input::new()
                    .with_prompt("API key (leave blank if not required)")
                    .allow_empty(true)
                    .interact_text()?;

                let choices = [BACK, "Continue"];
                let idx = Select::new()
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
                let idx = Select::new()
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
                let idx = Select::new()
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
                let idx = Select::new()
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

fn cmd_quality(args: QualityArgs, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    let stub = |label: &str| out.dim(&format!("{label}: not yet implemented (Phase 5b)"));
    match args.command {
        None => {
            let config_path = resolve_config_path(&args.config)?;
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

fn cmd_init(args: ConfigPathArg, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    use dialoguer::{Confirm, Input, MultiSelect, Select};

    out.section("Virage Setup");
    out.dim("Use ← Back to return to the previous step.");
    println!();

    const BACK: &str = "← Back";

    // Wizard state — pre-fill config_path from --config flag if provided
    let default_config = if args.config.is_empty() {
        "virage.config.json".to_string()
    } else {
        args.config.clone()
    };
    let mut config_path = default_config.clone();
    let mut scan_path = String::from(".");
    let mut selected_type_indices: Vec<usize> = vec![];
    let mut source_pkg = "@vivantel/virage-source-git";
    let mut embedder_pkg = "@vivantel/virage-embedder-onnx";
    let mut store_pkg = "@vivantel/virage-store-lancedb";
    let mut reranker_pkg: Option<&str> = None;
    let mut use_hybrid = false;

    let mut step = 0usize;

    loop {
        match step {
            // ── Step 1: Config path ───────────────────────────────────────────
            0 => {
                config_path = Input::new()
                    .with_prompt("Config file path")
                    .default(default_config.clone())
                    .interact_text()?;
                step += 1;
            }

            // ── Step 2: Scan path + overwrite check ───────────────────────────
            1 => {
                scan_path = Input::new()
                    .with_prompt("Root directory to index")
                    .default(".".into())
                    .interact_text()?;

                if std::path::Path::new(&config_path).exists() {
                    let choices = [BACK, "Overwrite existing config", "Cancel"];
                    let idx = Select::new()
                        .with_prompt(format!("{config_path} already exists"))
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
                }
                step += 1;
            }

            // ── Step 3: File type detection + multiselect ─────────────────────
            2 => {
                let counts = detect_file_types(std::path::Path::new(&scan_path));

                let mut labels: Vec<String> = FILE_TYPE_META
                    .iter()
                    .map(|(key, label, _, _)| {
                        if let Some(n) = counts.get(*key) {
                            format!("{label} [{n} files]")
                        } else {
                            label.to_string()
                        }
                    })
                    .collect();
                labels.push(BACK.to_string());

                let mut defaults: Vec<bool> = FILE_TYPE_META
                    .iter()
                    .map(|(key, _, _, _)| counts.contains_key(*key))
                    .collect();
                defaults.push(false); // BACK never pre-checked

                let picked = MultiSelect::new()
                    .with_prompt("File types to index (Space = toggle, Enter = confirm)")
                    .items(&labels)
                    .defaults(&defaults)
                    .interact()?;

                if picked.contains(&FILE_TYPE_META.len()) {
                    step = step.saturating_sub(1);
                    continue;
                }
                if picked.is_empty() {
                    out.warn("Select at least one file type.");
                    continue;
                }
                selected_type_indices = picked;
                step += 1;
            }

            // ── Step 4: Source provider ───────────────────────────────────────
            3 => {
                let choices = [BACK, "git (default)", "localfs (no git required)"];
                let idx = Select::new()
                    .with_prompt("Source provider")
                    .items(&choices)
                    .default(1)
                    .interact()?;
                match idx {
                    0 => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    2 => source_pkg = "@vivantel/virage-source-localfs",
                    _ => source_pkg = "@vivantel/virage-source-git",
                }
                step += 1;
            }

            // ── Step 5: Embedder ──────────────────────────────────────────────
            4 => {
                let choices = [
                    BACK,
                    "ONNX (local, no API key needed)",
                    "OpenAI text-embedding-3-small",
                    "Cohere embed-english-v3",
                    "FastEmbed (Qdrant, local)",
                ];
                let idx = Select::new()
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

            // ── Step 6: Vector store ──────────────────────────────────────────
            5 => {
                let choices = [
                    BACK,
                    "LanceDB (local, file-based)",
                    "Qdrant (self-hosted or cloud)",
                    "PostgreSQL + pgvector",
                    "ChromaDB",
                ];
                let idx = Select::new()
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

            // ── Step 7: Reranker + hybrid ─────────────────────────────────────
            6 => {
                let choices = [
                    BACK,
                    "None (skip, use vector similarity only)",
                    "ONNX cross-encoder (local, improves precision)",
                    "Cohere rerank-english-v3",
                ];
                let idx = Select::new()
                    .with_prompt("Reranker")
                    .items(&choices)
                    .default(1)
                    .interact()?;
                match idx {
                    0 => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    2 => reranker_pkg = Some("@vivantel/virage-reranker-onnx"),
                    3 => reranker_pkg = Some("@vivantel/virage-reranker-cohere"),
                    _ => reranker_pkg = None,
                }

                if reranker_pkg.is_some() {
                    use_hybrid = Confirm::new()
                        .with_prompt("Enable hybrid search (dense + sparse BM25)?")
                        .default(true)
                        .interact()?;
                } else {
                    use_hybrid = false;
                }
                step += 1;
            }

            // ── Step 8: Summary + confirm ─────────────────────────────────────
            7 => {
                let type_names: Vec<&str> = selected_type_indices
                    .iter()
                    .map(|&i| FILE_TYPE_META[i].1)
                    .collect();

                out.section("Summary");
                out.info(&format!("  Config     : {config_path}"));
                out.info(&format!("  Scan path  : {scan_path}"));
                out.info(&format!("  File types : {}", type_names.join(", ")));
                out.info(&format!("  Source     : {source_pkg}"));
                out.info(&format!("  Embedder   : {embedder_pkg}"));
                out.info(&format!("  Store      : {store_pkg}"));
                if let Some(r) = reranker_pkg {
                    out.info(&format!("  Reranker   : {r}"));
                    out.info(&format!("  Hybrid     : {use_hybrid}"));
                }
                println!();

                let choices = [BACK, "Write config", "Cancel"];
                let idx = Select::new()
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
        entry.0.extend_from_slice(patterns); // include patterns
        entry.1.push(FILE_TYPE_META[i].0); // type names for the set name
    }

    let mut file_sets = Vec::new();
    for (chunker, (patterns, type_names)) in &chunker_groups {
        let set_name = if type_names.len() == 1 {
            type_names[0].to_lowercase().replace(" / ", "-")
        } else {
            "code".to_string()
        };
        file_sets.push(serde_json::json!({
            "name": set_name,
            "include": patterns,
            "chunkers": [{ "package": chunker }]
        }));
    }

    let mut providers = serde_json::json!({
        "embedder": { "package": embedder_pkg },
        "vectorStore": { "package": store_pkg },
        "source": { "package": source_pkg }
    });
    if let Some(r) = reranker_pkg {
        providers["reranker"] = serde_json::json!({ "package": r });
    }

    let mut cfg = serde_json::json!({
        "$schema": "https://vivantel.com/virage/schema/v2/config.json",
        "version": "1.0.0",
        "providers": providers,
        "fileSets": file_sets
    });

    if use_hybrid {
        cfg["pipeline"] = serde_json::json!({ "hybrid": true });
    }

    std::fs::write(&config_path, serde_json::to_string_pretty(&cfg)?)?;
    println!();
    out.success(&format!("Config written to {config_path}"));
    out.dim("Next: run `virage index` to build the index.");
    Ok(())
}

// ─── update ──────────────────────────────────────────────────────────────────

fn cmd_update(verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
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
    out.dim("Checking versions...");
    let mut statuses: Vec<PackageStatus> = Vec::new();
    for pkg in &packages {
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

    let selected = MultiSelect::new()
        .with_prompt("Packages to update (Space = toggle, Enter = confirm)")
        .items(&labels)
        .defaults(&defaults)
        .interact()?;

    if selected.is_empty() {
        out.info("Nothing selected.");
        return Ok(());
    }

    // ── 5. Install selected packages ──────────────────────────────────────────
    let to_install: Vec<&str> = selected
        .iter()
        .map(|&i| statuses[i].name.as_str())
        .collect();
    out.info(&format!("Installing {} package(s)...", to_install.len()));

    for pkg in &to_install {
        out.dim(&format!("  npm install -g {pkg}@latest"));
        let status = std::process::Command::new(npm)
            .args(["install", "-g", &format!("{pkg}@latest")])
            .status();
        match status {
            Ok(s) if s.success() => out.success(&format!("  {pkg}")),
            Ok(s) => out.warn(&format!("  {pkg}: npm exited {s}")),
            Err(e) => out.error(&format!("  {pkg}: {e}")),
        }
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

fn cmd_pack(args: PackArgs, verbose: u8) -> anyhow::Result<()> {
    use flate2::{write::GzEncoder, Compression};
    let out = Out::new(verbose);

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

fn cmd_uninstall(verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    use dialoguer::Confirm;

    out.section("Virage Uninstall");

    let hooks_dir = PathBuf::from(".git/hooks");
    if hooks_dir.exists() {
        for hook in &["post-merge", "post-checkout"] {
            let p = hooks_dir.join(hook);
            if p.exists()
                && Confirm::new()
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
        && Confirm::new()
            .with_prompt("Remove .virage/ (index DB)?")
            .default(false)
            .interact()?
    {
        std::fs::remove_dir_all(&virage_dir)?;
        out.success("Removed: .virage/");
    }

    let config = PathBuf::from("virage.config.json");
    if config.exists()
        && Confirm::new()
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

fn cmd_dashboard(args: DashboardArgs, verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    let db_path = resolve_db_path(&args.db);
    let mut cmd = std::process::Command::new("npx");
    cmd.args([
        "@vivantel/virage-dashboard",
        "--port",
        &args.port.to_string(),
        "--db",
        &db_path,
    ]);
    if !args.config.is_empty() {
        cmd.args(["--config", &args.config]);
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

async fn cmd_serve(args: ConfigPathArg) -> anyhow::Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let config_path = resolve_config_path(&args.config)?;
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

fn cmd_plugin(args: PluginArgs, verbose: u8) -> anyhow::Result<()> {
    match args.command {
        PluginCommand::Test { path } => cmd_plugin_test(&path, verbose),
    }
}

fn cmd_plugin_test(path: &str, verbose: u8) -> anyhow::Result<()> {
    #[cfg(feature = "wasm-host")]
    return cmd_plugin_test_wasm(path, verbose);
    #[cfg(not(feature = "wasm-host"))]
    {
        let out = Out::new(verbose);
        out.warn("WASM host not available — rebuild with --features wasm-host.");
        Ok(())
    }
}

#[cfg(feature = "wasm-host")]
fn cmd_plugin_test_wasm(path: &str, verbose: u8) -> anyhow::Result<()> {
    use virage_engine::plugins::wasm::chunker::WasmChunkerAdapter;
    use virage_engine::plugins::wasm::{FileInfo, WasmPluginHost, WasmRegistry};
    let out = Out::new(verbose);

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

fn cmd_usage(verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    out.info("Usage tracking is handled by the virage-agent-claude plugin.");
    out.dim("See: https://vivantel.com/virage/docs/telemetry");
    Ok(())
}

fn cmd_read_skill_summary(verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
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

fn cmd_viz(verbose: u8) -> anyhow::Result<()> {
    let out = Out::new(verbose);
    out.dim("virage viz: embedding visualisation is deferred post-v2.");
    Ok(())
}

// ─── Banner ───────────────────────────────────────────────────────────────────

fn print_banner() {
    use console::style;
    println!();
    println!(
        "  {} {}",
        style("virage").bold().cyan(),
        style(env!("CARGO_PKG_VERSION")).dim()
    );
    println!("  {}", style("AI code-search indexer").dim());
    println!();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let out = Out::new(cli.verbose);

    if !cli.no_banner {
        if matches!(
            cli.command,
            Some(Commands::Index(_))
                | Some(Commands::Query(_))
                | Some(Commands::Init(_))
                | Some(Commands::Update)
        ) {
            print_banner();
        }
    }

    let result = match cli.command {
        None => {
            // No subcommand → print help.
            Cli::parse_from(["virage", "--help"]);
            return;
        }
        Some(Commands::Index(args)) => cmd_index(args, cli.verbose).await,
        Some(Commands::Query(args)) => cmd_query(args, cli.verbose).await,
        Some(Commands::Validate(args)) => cmd_validate(args, cli.verbose),
        Some(Commands::Check(args)) => cmd_check(args, cli.verbose).await,
        Some(Commands::Report(args)) => cmd_report(args, cli.verbose),
        Some(Commands::Init(args)) => cmd_init(args, cli.verbose),
        Some(Commands::Update) => cmd_update(cli.verbose),
        Some(Commands::Migrate(args)) => cmd_migrate(args, cli.verbose),
        Some(Commands::Pack(args)) => cmd_pack(args, cli.verbose),
        Some(Commands::InstallHooks(args)) => cmd_install_hooks(args, cli.verbose),
        Some(Commands::Uninstall) => cmd_uninstall(cli.verbose),
        Some(Commands::Telemetry(args)) => cmd_telemetry(args, cli.verbose),
        Some(Commands::Store(args)) => match args.command {
            StoreCommand::Stats(a) => cmd_store_stats(a, cli.verbose).await,
            StoreCommand::Perf(a) => cmd_store_perf(a, cli.verbose).await,
        },
        Some(Commands::Chunks(args)) => match args.command {
            ChunksCommand::Report(a) => cmd_chunks_report(a, cli.verbose),
        },
        Some(Commands::Serve(args)) => cmd_serve(args).await,
        Some(Commands::Plugin(args)) => cmd_plugin(args, cli.verbose),
        Some(Commands::Usage) => cmd_usage(cli.verbose),
        Some(Commands::ReadSkillSummary) => cmd_read_skill_summary(cli.verbose),
        Some(Commands::Dashboard(args)) => cmd_dashboard(args, cli.verbose),
        Some(Commands::Viz) => cmd_viz(cli.verbose),
        Some(Commands::Quality(args)) => cmd_quality(args, cli.verbose),
    };

    if let Err(e) = result {
        out.error(&e.to_string());
        std::process::exit(1);
    }
}
