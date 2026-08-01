use clap::{Parser, Subcommand};
use virage_engine::cli::{
    self, BenchArgs, ChunksArgs, ChunksCommand, ConfigPathArg, DashboardArgs, DbPathArg, EvalArgs,
    IndexArgs, PackArgs, PluginArgs, QualityArgs, QueryArgs, ReadSkillSummaryArgs, ServeArgs,
    StoreArgs, StoreCommand, TelemetryArgs,
};
use virage_engine::config::{find_config, load_config};
use virage_engine::output::OutputFormat;

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

    /// Output format: human (default), json (machine-readable), quiet (errors only),
    /// markdown (PR-comment bots — eval/quality/bench commands only)
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
    Markdown,
}

impl From<CliFormat> for OutputFormat {
    fn from(f: CliFormat) -> Self {
        match f {
            CliFormat::Human => OutputFormat::Human,
            CliFormat::Json => OutputFormat::Json,
            CliFormat::Quiet => OutputFormat::Quiet,
            CliFormat::Markdown => OutputFormat::Markdown,
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
    /// Start the MCP server.
    Serve(ServeArgs),
    /// Test a WASM plugin against fixture data.
    Plugin(PluginArgs),
    /// Print the virage-agent-claude usage notice.
    #[command(aliases = ["use"])]
    Usage,
    /// Print a skill's summary, or the first 20 lines of each skill file if no name is given.
    #[command(aliases = ["skill"])]
    ReadSkillSummary(ReadSkillSummaryArgs),
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
    /// Retrieval-accuracy evaluation against RAGBench or a custom dataset.
    /// Under `--ci`, exits 4 if any must-pass metric fails its gate threshold.
    Eval(EvalArgs),
    /// Runtime performance benchmarking (indexing throughput).
    /// Under `--ci`, exits 5 on a regression vs. the shared history store's last run.
    Bench(BenchArgs),
    /// 26-metric pipeline-health model. Under `--ci`, exits 3 if any must-pass metric fails.
    #[command(aliases = ["ql"])]
    Quality(QualityArgs),
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
                .next_back()
                .unwrap_or(&cfg.providers.embedder.package)
                .trim_start_matches("virage-embedder-");
            let store_short = cfg
                .providers
                .vector_store
                .package
                .split('/')
                .next_back()
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
    let out = virage_engine::output::Out::new(cli.verbose, format);

    cli::init_logging(cli.verbose, config);

    if !cli.no_banner && format == OutputFormat::Human {
        print_banner();
    }

    let result = match cli.command {
        None => {
            // No subcommand → print help.
            Cli::parse_from(["virage", "--help"]);
            return;
        }
        Some(Commands::Index(args)) => cli::cmd_index(args, cli.verbose, format, config).await,
        Some(Commands::Query(args)) => cli::cmd_query(args, cli.verbose, format, config).await,
        Some(Commands::Validate(args)) => {
            cli::cmd_validate(args, cli.verbose, format, config).await
        }
        Some(Commands::Check(args)) => cli::cmd_check(args, cli.verbose, format, config).await,
        Some(Commands::Report(args)) => cli::cmd_report(args, cli.verbose, format),
        // H14: treat Ctrl+C (inquire::InquireError::OperationInterrupted) as clean cancellation,
        // exit 0 — not an error. `Esc` (OperationCanceled) never reaches here: every wizard step
        // catches it internally as its own back-navigation signal (select_step/multiselect_step).
        Some(Commands::Init(args)) => {
            cli::cmd_init(args, cli.verbose, format, config).inspect_err(|e| {
                if matches!(
                    e.downcast_ref::<inquire::InquireError>(),
                    Some(inquire::InquireError::OperationInterrupted)
                ) {
                    eprintln!("Cancelled.");
                    std::process::exit(0);
                }
            })
        }
        Some(Commands::Update) => cli::cmd_update(cli.verbose, format).inspect_err(|e| {
            if matches!(
                e.downcast_ref::<inquire::InquireError>(),
                Some(inquire::InquireError::OperationInterrupted)
            ) {
                eprintln!("Cancelled.");
                std::process::exit(0);
            }
        }),
        Some(Commands::Migrate(args)) => cli::cmd_migrate(args, cli.verbose, format, config),
        Some(Commands::Pack(args)) => cli::cmd_pack(args, cli.verbose, format),
        Some(Commands::InstallHooks(args)) => {
            cli::cmd_install_hooks(args, cli.verbose, format, config)
        }
        Some(Commands::Uninstall) => cli::cmd_uninstall(cli.verbose, format),
        Some(Commands::Telemetry(args)) => cli::cmd_telemetry(args, cli.verbose, format),
        Some(Commands::Store(args)) => match args.command {
            StoreCommand::Stats(a) => cli::cmd_store_stats(a, cli.verbose, format, config).await,
            StoreCommand::Perf(a) => cli::cmd_store_perf(a, cli.verbose, format, config).await,
        },
        Some(Commands::Chunks(args)) => match args.command {
            ChunksCommand::Report(a) => cli::cmd_chunks_report(a, cli.verbose, format),
        },
        Some(Commands::Serve(args)) => cli::cmd_serve(&args, config).await,
        Some(Commands::Plugin(args)) => cli::cmd_plugin(args, cli.verbose, format),
        Some(Commands::Usage) => cli::cmd_usage(cli.verbose, format),
        Some(Commands::ReadSkillSummary(args)) => {
            cli::cmd_read_skill_summary(args.skill_name, cli.verbose, format)
        }
        Some(Commands::Status(args)) => cli::cmd_status(args, cli.verbose, format, config).await,
        Some(Commands::Doctor(args)) => cli::cmd_doctor(args, cli.verbose, format, config).await,
        Some(Commands::Completions { shell }) => {
            use clap::CommandFactory;
            cli::cmd_completions(shell, &mut Cli::command());
            Ok(())
        }
        Some(Commands::Dashboard(args)) => cli::cmd_dashboard(args, cli.verbose, format, config),
        Some(Commands::Viz) => cli::cmd_viz(cli.verbose, format),
        Some(Commands::Eval(args)) => cli::cmd_eval(args, cli.verbose, format, config).await,
        Some(Commands::Bench(args)) => cli::cmd_bench(args, cli.verbose, format, config).await,
        Some(Commands::Quality(args)) => cli::cmd_quality(args, cli.verbose, format, config).await,
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
