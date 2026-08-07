//! Structured logging subscriber. Emits JSON to stderr and, optionally, an append-only file —
//! no remote transport, no rotation. Stderr, not stdout: commands like `virage query --format
//! json`/`quality run --format json` write machine-readable results to stdout for piping, and
//! log lines interleaved there would break any consumer's `JSON.parse` (see IR-038's Step 9 CI
//! migration, which hit exactly this). [`registry`] is exposed separately from [`init`] so a
//! downstream binary can attach additional `Layer`s (e.g. for remote transport) on top before
//! calling `.init()` itself, rather than duplicating subscriber-init logic.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter, Registry};

use crate::progress::active_multi_progress;

/// Wraps stderr so that any write suspends the process's active `indicatif` `MultiProgress` (if
/// one exists — see `progress::active_multi_progress`) around the write, instead of the two
/// racing on the terminal unsynchronized. Found necessary during the IR-040 investigation: real
/// `lance::file_audit` log lines were observed splicing mid-render into the indexing spinner's
/// line. A no-op (plain stderr write) when no `MultiProgress` is active, e.g. `Json`/`Quiet`
/// format or before any progress bar has been created.
struct SuspendingStderr;

impl Write for SuspendingStderr {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match active_multi_progress() {
            Some(mp) => mp.suspend(|| std::io::stderr().write(buf)),
            None => std::io::stderr().write(buf),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        std::io::stderr().flush()
    }
}

fn make_suspending_stderr() -> SuspendingStderr {
    SuspendingStderr
}

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
/// convention) — falls back to a target-scoped default otherwise: `config.level` for virage's own
/// code, but `lance::file_audit` (the vendored `lance` crate's internal storage-operation audit
/// trail — one event per physical file write/manifest/commit) capped at `warn`. Without this
/// scoping, a bare `config.level` directive of `"info"` matches every crate equally, and
/// `lance::file_audit` floods stdout during large indexing runs — confirmed via a real `virage
/// index --force` repro during the IR-040 investigation. Still fully overridable: `RUST_LOG=lance::
/// file_audit=debug` (or any `RUST_LOG` value at all) wins outright, same as before.
fn env_filter(config: &LoggingConfig) -> EnvFilter {
    EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("{},lance::file_audit=warn", config.level)))
}

/// Build the base registry: env-filtered, always-JSON stderr layer, plus an optional JSON file
/// layer. Returns a `Subscriber` (not yet initialized as global default) so a caller can attach
/// additional `Layer`s via `.with(layer)` before calling `.init()`.
pub fn registry(
    config: &LoggingConfig,
) -> impl tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a> {
    let stderr_layer = fmt::layer().json().with_writer(make_suspending_stderr);

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
