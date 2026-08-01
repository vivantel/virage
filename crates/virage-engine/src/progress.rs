use std::sync::OnceLock;

use console::style;
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};

use crate::output::OutputFormat;

const SPINNER_TICKS: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_MS: u64 = 80;

/// The process's one active `MultiProgress`, if any (`Human` format only — `Json`/`Quiet` never
/// set this). At most one `Progress` is created per CLI invocation, so a single global handle is
/// sufficient. `logging::init`'s writer uses this to suspend the progress bar around log lines,
/// instead of both writing to the terminal unsynchronized.
static ACTIVE_MULTI_PROGRESS: OnceLock<MultiProgress> = OnceLock::new();

/// The active `MultiProgress`, if `Progress::new` has created one in this process. Used by
/// `logging::init` to suspend bar rendering while a log line prints.
pub fn active_multi_progress() -> Option<&'static MultiProgress> {
    ACTIVE_MULTI_PROGRESS.get()
}

pub struct Progress {
    mp: Option<MultiProgress>,
}

impl Progress {
    pub fn new(format: OutputFormat) -> Self {
        if format == OutputFormat::Human {
            let mp = MultiProgress::new();
            // Best-effort: if a Progress was already created this process (shouldn't happen —
            // one per CLI invocation — but never panic over it), keep using the first one.
            let _ = ACTIVE_MULTI_PROGRESS.set(mp.clone());
            Self { mp: Some(mp) }
        } else {
            Self { mp: None }
        }
    }

    pub fn stage(&self, msg: &str) -> ProgressBar {
        match &self.mp {
            None => ProgressBar::hidden(),
            Some(mp) => {
                let pb = mp.add(ProgressBar::new_spinner());
                pb.set_style(
                    ProgressStyle::with_template("{spinner:.cyan} {msg}")
                        .unwrap()
                        .tick_strings(SPINNER_TICKS),
                );
                pb.set_message(msg.to_string());
                pb.enable_steady_tick(std::time::Duration::from_millis(TICK_MS));
                pb
            }
        }
    }

    pub fn file_bar(&self, total: u64, label: &str) -> ProgressBar {
        match &self.mp {
            None => ProgressBar::hidden(),
            Some(mp) => {
                let pb = mp.add(ProgressBar::new(total));
                pb.set_style(
                    ProgressStyle::with_template(
                        "{spinner:.cyan} {msg:12} [{bar:30.cyan/blue}] {pos}/{len} files",
                    )
                    .unwrap()
                    .tick_strings(SPINNER_TICKS)
                    .progress_chars("█▓░"),
                );
                pb.set_message(label.to_string());
                pb.enable_steady_tick(std::time::Duration::from_millis(TICK_MS));
                pb
            }
        }
    }
}

/// Complete a stage spinner with a green ✓, keeping it visible on the terminal.
/// Reads the label from the bar's current message (strips trailing "...").
pub fn finish_stage(pb: ProgressBar) {
    let raw = pb.message().to_string();
    let label = raw.trim_end_matches("...");
    pb.finish_with_message(style(format!("✓ {label}")).green().to_string());
}
