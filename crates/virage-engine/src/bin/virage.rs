use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use clap::{Args, Parser, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};

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
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Index (or re-index) source files into the vector store.
    Index(IndexArgs),
    /// Search the vector index with a natural-language query.
    Query(QueryArgs),
    /// Validate the config file and report issues.
    Validate(ConfigPathArg),
    /// Check index metadata against the current embedder config.
    Check(ConfigPathArg),
    /// Show indexing run diagnostics from the state DB.
    Report(DbPathArg),
    /// Interactive setup wizard.
    Init(ConfigPathArg),
    /// Update WASM plugins and the virage binary.
    Update,
    /// Migrate a v1 virage.config.json to v2 format.
    Migrate(ConfigPathArg),
    /// Pack the `.virage/` directory as a `.tar.gz` archive.
    Pack(PackArgs),
    /// Write git post-merge and post-checkout hooks.
    InstallHooks(ConfigPathArg),
    /// Remove hooks, DB, config, and optionally the global binary.
    Uninstall,
    /// Manage telemetry settings.
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
    Usage,
    /// Print the first 20 lines of each skill file.
    ReadSkillSummary,
    /// Start the virage dashboard web UI (requires Node.js).
    Dashboard(DashboardArgs),
    /// [Deferred post-v2] Visualise embeddings.
    Viz,
    /// Validate, then run quality metrics and exit 1 if any gate fails.
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
    Status,
    On,
    Off,
    Preview,
    Flush,
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

async fn cmd_index(args: IndexArgs) -> anyhow::Result<()> {
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

    // ── Dry-run mode ──────────────────────────────────────────────────────────
    if dry_run {
        use futures::StreamExt;
        println!("Dry-run mode — computing changes without indexing...");
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
        println!("  Files to index  : {}", to_process.len());
        println!(
            "  Files unchanged : {}",
            all_paths.len().saturating_sub(to_process.len())
        );
        println!("  Files to delete : {}", to_delete.len());
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

    println!(
        "Done.  Processed: {}  Skipped: {}  Deleted: {}  Chunks: {}",
        stats.files_processed, stats.files_skipped, stats.files_deleted, stats.chunks_upserted,
    );
    Ok(())
}

async fn cmd_query(args: QueryArgs) -> anyhow::Result<()> {
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
        println!("No results found.");
        return Ok(());
    }

    println!(
        "\nTop {} result(s) for: \"{}\"\n",
        results.len(),
        args.query
    );
    for (i, r) in results.iter().enumerate() {
        let snippet = if r.dense_text.len() > 400 {
            format!("{}…", &r.dense_text[..400])
        } else {
            r.dense_text.clone()
        };
        let src = r.source_file.as_deref().unwrap_or("unknown");
        println!(
            "[{}] {}  (similarity: {:.1}%)\n{}",
            i + 1,
            src,
            r.similarity * 100.0,
            snippet
        );
        println!("{}", "─".repeat(60));
    }
    Ok(())
}

fn cmd_validate(args: ConfigPathArg) -> anyhow::Result<()> {
    let config_path = resolve_config_path(&args.config)?;
    println!("Validating config: {config_path}");

    let cfg = load_config(&config_path)?;

    if cfg.file_sets.is_empty() {
        return Err(anyhow::anyhow!("fileSets must have at least one entry"));
    }

    let mut warnings = 0usize;

    for fs in &cfg.file_sets {
        if fs.chunkers.is_empty() {
            eprintln!("  WARN  fileSet {:?}: chunkers is empty", fs.name);
            warnings += 1;
        }
        if fs.include.is_empty() {
            eprintln!(
                "  WARN  fileSet {:?}: no include patterns — will match nothing",
                fs.name
            );
            warnings += 1;
        }
        for pat in &fs.include {
            // Validate that the glob pattern is syntactically valid.
            match globset::Glob::new(pat) {
                Ok(_) => {
                    println!("  OK    fileSet {:?}: pattern {:?} is valid", fs.name, pat);
                }
                Err(e) => {
                    eprintln!(
                        "  WARN  fileSet {:?}: invalid pattern {:?}: {e}",
                        fs.name, pat
                    );
                    warnings += 1;
                }
            }
        }
    }

    println!("\nEmbedder  : {}", cfg.providers.embedder.package);
    println!("Store     : {}", cfg.providers.vector_store.package);
    if let Some(src) = &cfg.providers.source {
        println!("Source    : {}", src.package);
    }
    println!("FileSets  : {}", cfg.file_sets.len());

    if warnings > 0 {
        println!("\nConfig loaded with {warnings} warning(s).");
    } else {
        println!("\nConfig is valid.");
    }
    Ok(())
}

async fn cmd_check(args: ConfigPathArg) -> anyhow::Result<()> {
    let config_path = resolve_config_path(&args.config)?;
    let cfg = load_config(&config_path)?;
    let dims = embedder_dims(&cfg);

    let pb = spinner("Connecting to vector store...");
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;
    pb.finish_and_clear();

    let state = store.current_state().await?;
    println!("Vector store  : {}", cfg.providers.vector_store.package);
    println!("Indexed files : {}", state.len());
    println!("Dimensions    : {dims}");
    println!("Status        : OK");
    Ok(())
}

fn cmd_report(args: DbPathArg) -> anyhow::Result<()> {
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

    println!("=== Virage Report ===");
    println!("DB path          : {db_path}");
    println!("Indexed files    : {}", revisions.len());
    println!("Pending embed    : {pending_embed}");
    println!("Pending upload   : {pending_upload}");
    Ok(())
}

fn cmd_chunks_report(args: DbPathArg) -> anyhow::Result<()> {
    let db_path = resolve_db_path(&args.db);
    let db = open_or_init_db(&db_path)?;
    let revisions = db
        .get_file_revisions()
        .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;

    if revisions.is_empty() {
        println!("No indexed files found in {db_path}.");
        return Ok(());
    }

    println!("=== Chunks Report ({} files) ===", revisions.len());
    let mut files: Vec<_> = revisions.iter().collect();
    files.sort_by_key(|(k, _)| k.as_str());
    for (file, rev) in &files {
        println!("  {}  [{}]", file, &rev[..rev.len().min(8)]);
    }
    Ok(())
}

async fn cmd_store_stats(args: ConfigPathArg) -> anyhow::Result<()> {
    let config_path = resolve_config_path(&args.config)?;
    let cfg = load_config(&config_path)?;
    let dims = embedder_dims(&cfg);

    let pb = spinner("Connecting to vector store...");
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;
    pb.finish_and_clear();

    let state = store.current_state().await?;
    println!("=== Store Stats ===");
    println!("Package       : {}", cfg.providers.vector_store.package);
    println!("Indexed files : {}", state.len());
    println!("Dimensions    : {dims}");
    Ok(())
}

fn cmd_migrate(args: ConfigPathArg) -> anyhow::Result<()> {
    let config_path = resolve_config_path(&args.config)?;
    let text = std::fs::read_to_string(&config_path)
        .map_err(|e| anyhow::anyhow!("Cannot read {:?}: {e}", config_path))?;
    let mut value: serde_json::Value = serde_json::from_str(&text)?;

    // v1 used `"package": "@vivantel/..."` everywhere — v2 is the same,
    // but normalize any legacy `tags` → keep as-is (already v2 if parseable).
    let already_v2 = value.get("providers").is_some() && value.get("fileSets").is_some();
    if already_v2 {
        println!("Config is already v2 format — nothing to migrate.");
        return Ok(());
    }
    println!("Migrating {config_path} ...");
    // Rewrite `version` to current schema version.
    if let Some(obj) = value.as_object_mut() {
        obj.insert("version".into(), serde_json::json!("1.0.0"));
    }
    let backup = format!("{config_path}.bak");
    std::fs::copy(&config_path, &backup)?;
    std::fs::write(&config_path, serde_json::to_string_pretty(&value)?)?;
    println!("Backup saved to {backup}");
    println!("Migration complete.");
    Ok(())
}

fn cmd_install_hooks(args: ConfigPathArg) -> anyhow::Result<()> {
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
        println!("Installed hook: {}", hook_path.display());
    }
    Ok(())
}

fn cmd_telemetry(args: TelemetryArgs) -> anyhow::Result<()> {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let config_dir = PathBuf::from(home).join(".config").join("virage");
    let flag_file = config_dir.join("telemetry.enabled");
    match args.command {
        TelemetryCommand::Status => {
            let enabled = flag_file.exists();
            println!(
                "Telemetry: {}",
                if enabled { "enabled" } else { "disabled" }
            );
        }
        TelemetryCommand::On => {
            std::fs::create_dir_all(&config_dir)?;
            std::fs::write(&flag_file, "")?;
            println!("Telemetry enabled.");
        }
        TelemetryCommand::Off => {
            let _ = std::fs::remove_file(&flag_file);
            println!("Telemetry disabled.");
        }
        TelemetryCommand::Preview => {
            println!("[telemetry preview] No pending events.");
        }
        TelemetryCommand::Flush => {
            println!("[telemetry flush] No events to flush.");
        }
    }
    Ok(())
}

fn cmd_quality(args: QualityArgs) -> anyhow::Result<()> {
    match args.command {
        None => {
            let config_path = resolve_config_path(&args.config)?;
            println!("Quality metrics (Phase 5b) — config: {config_path}");
            println!("[Not yet implemented — see Phase 5b]");
        }
        Some(QualityCommand::Eval(eval_args)) => match eval_args.command {
            QualityEvalCommand::Run => {
                println!("[quality eval run] Not yet implemented — see Phase 5b")
            }
            QualityEvalCommand::Generate => println!("[quality eval generate] Not yet implemented"),
            QualityEvalCommand::Save => println!("[quality eval save] Not yet implemented"),
            QualityEvalCommand::List => println!("[quality eval list] Not yet implemented"),
            QualityEvalCommand::Compare => println!("[quality eval compare] Not yet implemented"),
        },
        Some(QualityCommand::Bench) => {
            println!("[quality bench] Not yet implemented — see Phase 5b")
        }
        Some(QualityCommand::Suite) => {
            println!("[quality suite] Not yet implemented — see Phase 5b")
        }
        Some(QualityCommand::History) => {
            println!("[quality history] Not yet implemented — see Phase 5b")
        }
    }
    Ok(())
}

// ─── init ────────────────────────────────────────────────────────────────────

fn cmd_init(_args: ConfigPathArg) -> anyhow::Result<()> {
    use dialoguer::{Input, Select};

    println!("=== Virage Setup Wizard ===\n");

    let config_path: String = Input::new()
        .with_prompt("Config file path")
        .default("virage.config.json".into())
        .interact_text()?;

    let source_choices = &["git (default)", "localfs", "custom"];
    let source_idx = Select::new()
        .with_prompt("Source type")
        .items(source_choices)
        .default(0)
        .interact()?;
    let source_pkg = match source_idx {
        1 => "@vivantel/virage-source-localfs",
        _ => "@vivantel/virage-source-git",
    };

    let embedder_choices = &[
        "ONNX (local, default)",
        "OpenAI text-embedding-3-small",
        "Cohere embed-english-v3",
    ];
    let embedder_idx = Select::new()
        .with_prompt("Embedder")
        .items(embedder_choices)
        .default(0)
        .interact()?;
    let embedder_pkg = match embedder_idx {
        1 => "@vivantel/virage-embedder-openai",
        2 => "@vivantel/virage-embedder-cohere",
        _ => "@vivantel/virage-embedder-onnx",
    };

    let store_choices = &[
        "LanceDB (local, default)",
        "Qdrant",
        "PostgreSQL",
        "ChromaDB",
    ];
    let store_idx = Select::new()
        .with_prompt("Vector store")
        .items(store_choices)
        .default(0)
        .interact()?;
    let store_pkg = match store_idx {
        1 => "@vivantel/virage-store-qdrant",
        2 => "@vivantel/virage-store-postgres",
        3 => "@vivantel/virage-store-chromadb",
        _ => "@vivantel/virage-store-lancedb",
    };

    let config = serde_json::json!({
        "$schema": "https://vivantel.com/virage/schema/v2/config.json",
        "version": "1.0.0",
        "providers": {
            "embedder": { "package": embedder_pkg },
            "vectorStore": { "package": store_pkg },
            "source": { "package": source_pkg }
        },
        "fileSets": [
            {
                "name": "code",
                "include": ["**/*.{ts,tsx,js,jsx,py,rs,go,java,md}"],
                "chunkers": [
                    { "package": "@vivantel/virage-chunker-ce-md" },
                    { "package": "@vivantel/virage-chunker-ce-lang" }
                ]
            }
        ]
    });

    std::fs::write(&config_path, serde_json::to_string_pretty(&config)?)?;
    println!("\nConfig written to {config_path}");
    println!("Run `virage index` to build the index.");
    Ok(())
}

// ─── update ──────────────────────────────────────────────────────────────────

fn cmd_update() -> anyhow::Result<()> {
    println!("Updating virage binary...");
    let status = std::process::Command::new("npm")
        .args(["install", "-g", "@vivantel/virage@latest"])
        .status();
    match status {
        Ok(s) if s.success() => println!("virage updated."),
        Ok(s) => eprintln!("npm exited with status {s}"),
        Err(e) => eprintln!("Failed to run npm: {e}\nInstall Node.js or update manually."),
    }
    Ok(())
}

// ─── pack ────────────────────────────────────────────────────────────────────

fn cmd_pack(args: PackArgs) -> anyhow::Result<()> {
    use flate2::{write::GzEncoder, Compression};

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
    println!("Archive created: {} ({} KB)", args.output, size / 1024);
    Ok(())
}

// ─── uninstall ───────────────────────────────────────────────────────────────

fn cmd_uninstall() -> anyhow::Result<()> {
    use dialoguer::Confirm;

    println!("=== Virage Uninstall ===\n");

    let hooks_dir = PathBuf::from(".git/hooks");
    if hooks_dir.exists() {
        for hook in &["post-merge", "post-checkout"] {
            let p = hooks_dir.join(hook);
            if p.exists() {
                if Confirm::new()
                    .with_prompt(format!("Remove git hook {hook}?"))
                    .default(false)
                    .interact()?
                {
                    std::fs::remove_file(&p)?;
                    println!("  Removed: {}", p.display());
                }
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
        println!("  Removed: .virage/");
    }

    let config = PathBuf::from("virage.config.json");
    if config.exists()
        && Confirm::new()
            .with_prompt("Remove virage.config.json?")
            .default(false)
            .interact()?
    {
        std::fs::remove_file(&config)?;
        println!("  Removed: virage.config.json");
    }

    println!("\nUninstall complete.");
    Ok(())
}

// ─── dashboard ───────────────────────────────────────────────────────────────

fn cmd_dashboard(args: DashboardArgs) -> anyhow::Result<()> {
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
    eprintln!("Starting dashboard on http://localhost:{} ...", args.port);
    eprintln!("Note: virage dashboard requires Node.js.");
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

fn cmd_plugin(args: PluginArgs) -> anyhow::Result<()> {
    match args.command {
        PluginCommand::Test { path } => cmd_plugin_test(&path),
    }
}

fn cmd_plugin_test(path: &str) -> anyhow::Result<()> {
    #[cfg(feature = "wasm-host")]
    return cmd_plugin_test_wasm(path);
    #[cfg(not(feature = "wasm-host"))]
    {
        eprintln!(
            "[virage plugin test] WASM host not available — rebuild with --features wasm-host."
        );
        Ok(())
    }
}

#[cfg(feature = "wasm-host")]
fn cmd_plugin_test_wasm(path: &str) -> anyhow::Result<()> {
    use virage_engine::plugins::wasm::chunker::WasmChunkerAdapter;
    use virage_engine::plugins::wasm::{FileInfo, WasmPluginHost, WasmRegistry};

    let wasm_path = std::path::Path::new(path);
    if !wasm_path.exists() {
        return Err(anyhow::anyhow!("File not found: {path}"));
    }

    println!("Loading plugin: {path}");
    let host = WasmPluginHost::new()?;
    let registry = WasmRegistry::new(host);
    let adapter = WasmChunkerAdapter::from_path(&registry, wasm_path, "{}")?;

    println!("  init + patterns...");
    let patterns = adapter.init_and_patterns()?;
    println!("  Patterns: {patterns:?}");

    println!("  parse + chunk smoke test...");
    let info = FileInfo {
        path: "smoke-test.txt".to_string(),
        hash: "smoke".to_string(),
        size: 13,
        modified_ms: 0,
    };
    let doc = adapter.parse(&info, b"Hello, world.")?;
    let chunks = adapter.chunk(&doc, &info, "HEAD")?;
    println!("  Produced {} chunk(s).", chunks.len());

    println!("Plugin test PASSED.");
    Ok(())
}

fn cmd_usage() -> anyhow::Result<()> {
    eprintln!(
        "Usage tracking is handled by the virage-agent-claude plugin.\n\
         See: https://vivantel.com/virage/docs/telemetry"
    );
    Ok(())
}

fn cmd_read_skill_summary() -> anyhow::Result<()> {
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
            println!("=== {} ===", entry.path().display());
            if let Ok(text) = std::fs::read_to_string(entry.path()) {
                for line in text.lines().take(20) {
                    println!("{line}");
                }
            }
            println!();
        }
    }
    if !found {
        println!("No skill files found in {:?}.", skill_dirs);
    }
    Ok(())
}

fn cmd_viz() -> anyhow::Result<()> {
    println!(
        "[virage viz embeddings] Deferred post-v2 — embedding visualisation not yet available."
    );
    Ok(())
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        None => {
            // No subcommand → print help.
            Cli::parse_from(["virage", "--help"]);
            return;
        }
        Some(Commands::Index(args)) => cmd_index(args).await,
        Some(Commands::Query(args)) => cmd_query(args).await,
        Some(Commands::Validate(args)) => cmd_validate(args),
        Some(Commands::Check(args)) => cmd_check(args).await,
        Some(Commands::Report(args)) => cmd_report(args),
        Some(Commands::Init(args)) => cmd_init(args),
        Some(Commands::Update) => cmd_update(),
        Some(Commands::Migrate(args)) => cmd_migrate(args),
        Some(Commands::Pack(args)) => cmd_pack(args),
        Some(Commands::InstallHooks(args)) => cmd_install_hooks(args),
        Some(Commands::Uninstall) => cmd_uninstall(),
        Some(Commands::Telemetry(args)) => cmd_telemetry(args),
        Some(Commands::Store(args)) => match args.command {
            StoreCommand::Stats(a) => cmd_store_stats(a).await,
            StoreCommand::Perf(_a) => {
                eprintln!("[virage store perf] Phase 5a stub.");
                Ok(())
            }
        },
        Some(Commands::Chunks(args)) => match args.command {
            ChunksCommand::Report(a) => cmd_chunks_report(a),
        },
        Some(Commands::Serve(args)) => cmd_serve(args).await,
        Some(Commands::Plugin(args)) => cmd_plugin(args),
        Some(Commands::Usage) => cmd_usage(),
        Some(Commands::ReadSkillSummary) => cmd_read_skill_summary(),
        Some(Commands::Dashboard(args)) => cmd_dashboard(args),
        Some(Commands::Viz) => cmd_viz(),
        Some(Commands::Quality(args)) => cmd_quality(args),
    };

    if let Err(e) = result {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
