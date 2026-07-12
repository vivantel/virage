use console::style;

const DIVIDER_WIDTH: usize = 60;

pub struct Out {
    pub verbosity: u8,
}

impl Out {
    pub fn new(verbosity: u8) -> Self {
        Self { verbosity }
    }

    pub fn error(&self, msg: &str) {
        eprintln!("{} {msg}", style("✕").red().bold());
    }

    pub fn warn(&self, msg: &str) {
        eprintln!("{} {msg}", style("⚠").yellow());
    }

    pub fn success(&self, msg: &str) {
        println!("{} {msg}", style("✓").green());
    }

    pub fn info(&self, msg: &str) {
        println!("{msg}");
    }

    pub fn dim(&self, msg: &str) {
        println!("{}", style(msg).dim());
    }

    pub fn verbose(&self, msg: &str) {
        if self.verbosity >= 1 {
            println!("{}", style(format!("  {msg}")).dim());
        }
    }

    pub fn debug_msg(&self, msg: &str) {
        if self.verbosity >= 2 {
            println!("{}", style(format!("  [debug] {msg}")).color256(240).dim());
        }
    }

    pub fn trace_msg(&self, msg: &str) {
        if self.verbosity >= 3 {
            println!("{}", style(format!("  [trace] {msg}")).dim());
        }
    }

    pub fn section(&self, label: &str) {
        let line = style("─".repeat(DIVIDER_WIDTH)).dim().to_string();
        println!("\n{line}");
        println!("{}", style(format!(" {label}")).bold().cyan());
        println!("{line}");
    }
}
