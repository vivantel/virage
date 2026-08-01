//! Library-visible implementations of the `virage` CLI's command handlers.
//!
//! This module holds the `cmd_*` functions and the clap `Args` structs that back them, so that
//! any binary embedding this crate (not just `bin/virage.rs`) can drive the same commands without
//! duplicating logic. The top-level `Cli`/`Commands` clap enum and `main()` stay in `bin/virage.rs`
//! — they define that particular binary's command surface and dispatch; this module only supplies
//! the implementations they call into.
//!
//! Typed-errors-at-the-public-API-boundary carve-out: functions here return `anyhow::Result<...>`
//! rather than a crate-specific error type. That's the accepted exception for CLI-facing code, and
//! it's why this surface lives behind the `cli-binary` feature gate instead of the crate root.

mod admin;
mod bench;
mod completions;
mod dashboard;
mod eval;
mod index;
mod maintenance;
mod plugin;
mod quality;
mod query;
mod report;
mod serve;
mod store;
mod telemetry;
mod update;
mod util;
mod validate;
mod wizard;

pub use admin::{
    cmd_doctor, cmd_read_skill_summary, cmd_status, cmd_usage, cmd_viz, ReadSkillSummaryArgs,
};
pub use bench::{cmd_bench, cmd_bench_index, BenchArgs, BenchCommand, BenchIndexArgs};
pub use completions::cmd_completions;
pub use dashboard::{cmd_dashboard, DashboardArgs};
pub use eval::{
    cmd_eval, cmd_eval_compare, cmd_eval_run, EvalArgs, EvalCommand, EvalCompareArgs, EvalRunArgs,
};
pub use index::{cmd_index, IndexArgs};
pub use maintenance::{cmd_install_hooks, cmd_migrate, cmd_pack, cmd_uninstall, PackArgs};
pub use plugin::{cmd_plugin, PluginArgs, PluginCommand};
pub use quality::{
    cmd_quality, cmd_quality_history, cmd_quality_run, QualityArgs, QualityCommand,
    QualityHistoryArgs, QualityRunArgs,
};
pub use query::{cmd_query, QueryArgs};
pub use report::{cmd_chunks_report, cmd_report, ChunksArgs, ChunksCommand};
pub use serve::{cmd_serve, ServeArgs};
pub use store::{cmd_store_perf, cmd_store_stats, StoreArgs, StoreCommand};
pub use telemetry::{cmd_telemetry, TelemetryArgs, TelemetryCommand};
pub use update::cmd_update;
pub use validate::{cmd_check, cmd_validate};
pub use wizard::cmd_init;

/// Config-path arg shared by several commands (`validate`, `check`, `init`, `migrate`,
/// `install-hooks`) that only take a `-c/--config` override via the top-level `Cli` flag and have
/// no command-specific fields of their own.
#[derive(clap::Args)]
pub struct ConfigPathArg {}

/// DB-path arg shared by several commands (`report`, `chunks report`, `status`, `doctor`).
#[derive(clap::Args)]
pub struct DbPathArg {
    /// Path to virage.db.
    #[arg(long, default_value = "")]
    pub db: String,
}

/// Best-effort logging init: reads `logging.level` from the config file if one resolves, falls
/// back to the `-vvvvv` → trace convention otherwise. `RUST_LOG` always wins (see
/// `crate::logging`). Never fails the command — a missing/invalid config file just means
/// default-level logging, the same as before this existed.
pub fn init_logging(verbose: u8, config: &str) {
    let level = util::resolve_config_path(config)
        .ok()
        .and_then(|path| crate::config::load_config(&path).ok())
        .and_then(|cfg| cfg.logging.and_then(|l| l.level))
        .unwrap_or_else(|| {
            if verbose >= 5 {
                "trace".to_string()
            } else {
                "info".to_string()
            }
        });

    crate::logging::init(&crate::logging::LoggingConfig {
        level,
        file_path: None,
    });
}
