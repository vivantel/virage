use indicatif::{MultiProgress, ProgressBar, ProgressStyle};

use crate::output::OutputFormat;

const SPINNER_TICKS: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_MS: u64 = 80;

pub struct Progress {
    mp: Option<MultiProgress>,
}

impl Progress {
    pub fn new(format: OutputFormat) -> Self {
        if format == OutputFormat::Human {
            Self {
                mp: Some(MultiProgress::new()),
            }
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
