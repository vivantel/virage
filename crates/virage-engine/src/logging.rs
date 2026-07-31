//! Structured logging subscriber. Emits JSON to stderr and, optionally, an append-only file —
//! no remote transport, no rotation. Stderr, not stdout: commands like `virage query --format
//! json`/`quality run --format json` write machine-readable results to stdout for piping, and
//! log lines interleaved there would break any consumer's `JSON.parse` (see IR-038's Step 9 CI
//! migration, which hit exactly this). [`registry`] is exposed separately from [`init`] so a
//! downstream binary can attach additional `Layer`s (e.g. for remote transport) on top before
//! calling `.init()` itself, rather than duplicating subscriber-init logic.

use std::fs::OpenOptions;
use std::path::PathBuf;

use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter, Registry};

/// Resolved logging configuration — from `virage.config.json`'s `logging` block, defaulted when
/// the block is absent.
#[derive(Debug, Clone)]
pub struct LoggingConfig {
    /// `tracing_subscriber::EnvFilter` directive string, e.g. `"info"` or `"virage_engine=debug"`.
    pub level: String,
    /// Append-only JSON log file. No rotation — the customer manages rotation externally.
    pub file_path: Option<PathBuf>,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: "info".to_string(),
            file_path: None,
        }
    }
}

/// `RUST_LOG` overrides `virage.config.json`'s `logging.level` when set (standard `tracing`
/// convention) — falls back to `config.level` otherwise.
fn env_filter(config: &LoggingConfig) -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(config.level.clone()))
}

/// Build the base registry: env-filtered, always-JSON stderr layer, plus an optional JSON file
/// layer. Returns a `Subscriber` (not yet initialized as global default) so a caller can attach
/// additional `Layer`s via `.with(layer)` before calling `.init()`.
pub fn registry(
    config: &LoggingConfig,
) -> impl tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a> {
    let stderr_layer = fmt::layer().json().with_writer(std::io::stderr);

    let file_layer = config.file_path.as_ref().and_then(|path| {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok()
            .map(|file| fmt::layer().json().with_writer(std::sync::Mutex::new(file)))
    });

    Registry::default()
        .with(env_filter(config))
        .with(stderr_layer)
        .with(file_layer)
}

/// Initialize global logging with no additional transport layers. Safe to call at most once per
/// process; a second call is a no-op (`try_init` swallows the "already set" error).
pub fn init(config: &LoggingConfig) {
    let _ = registry(config).try_init();
}
