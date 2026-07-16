use console::style;

const DIVIDER_WIDTH: usize = 60;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum OutputFormat {
    Human,
    Json,
    Quiet,
}

pub struct Out {
    pub verbosity: u8,
    pub format: OutputFormat,
}

impl Out {
    pub fn new(verbosity: u8, format: OutputFormat) -> Self {
        Self { verbosity, format }
    }

    // ── Human-only output (stderr) ──────────────────────────────

    pub fn section(&self, label: &str) {
        if self.format != OutputFormat::Human {
            return;
        }
        let line = style("─".repeat(DIVIDER_WIDTH)).dim().to_string();
        eprintln!("\n{line}");
        eprintln!("{}", style(format!(" {label}")).bold().cyan());
        eprintln!("{line}");
    }

    pub fn success(&self, msg: &str) {
        if self.format != OutputFormat::Human {
            return;
        }
        eprintln!("{} {msg}", style("✓").green());
    }

    pub fn info(&self, msg: &str) {
        if self.format != OutputFormat::Human {
            return;
        }
        eprintln!("{msg}");
    }

    pub fn dim(&self, msg: &str) {
        if self.format != OutputFormat::Human {
            return;
        }
        eprintln!("{}", style(msg).dim());
    }

    // ── Warning — human+quiet to stderr ────────────────────────

    pub fn warn(&self, msg: &str) {
        if self.format == OutputFormat::Json {
            return;
        }
        eprintln!("{} {msg}", style("⚠").yellow());
    }

    // ── Error — human/quiet to stderr; json to stdout ──────────

    pub fn error(&self, msg: &str) {
        match self.format {
            OutputFormat::Json => {
                println!(
                    "{{\"error\":{}}}",
                    serde_json::to_string(msg).unwrap_or_default()
                );
            }
            _ => {
                eprintln!("{} {msg}", style("✕").red().bold());
            }
        }
    }

    pub fn error_hint(&self, msg: &str, hint: &str) {
        match self.format {
            OutputFormat::Json => {
                println!(
                    "{{\"error\":{},\"hint\":{}}}",
                    serde_json::to_string(msg).unwrap_or_default(),
                    serde_json::to_string(hint).unwrap_or_default(),
                );
            }
            _ => {
                eprintln!("{} {msg}", style("✕").red().bold());
                eprintln!("   Hint: {hint}");
            }
        }
    }

    // ── Data output (stdout always) ─────────────────────────────

    pub fn data_json(&self, value: &serde_json::Value) {
        if self.format == OutputFormat::Json {
            println!(
                "{}",
                serde_json::to_string_pretty(value).unwrap_or_default()
            );
        }
    }

    pub fn data_line(&self, msg: &str) {
        if self.format != OutputFormat::Json {
            println!("{msg}");
        }
    }

    // ── Verbosity levels (stderr) ───────────────────────────────

    pub fn verbose(&self, msg: &str) {
        if self.format == OutputFormat::Human && self.verbosity >= 1 {
            eprintln!("{}", style(format!("  {msg}")).dim());
        }
    }

    pub fn debug_msg(&self, msg: &str) {
        if self.format == OutputFormat::Human && self.verbosity >= 3 {
            eprintln!("{}", style(format!("  [debug] {msg}")).color256(240).dim());
        }
    }

    pub fn trace_msg(&self, msg: &str) {
        if self.format == OutputFormat::Human && self.verbosity >= 5 {
            eprintln!("{}", style(format!("  [trace] {msg}")).dim());
        }
    }
}
