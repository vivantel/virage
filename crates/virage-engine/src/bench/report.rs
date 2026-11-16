//! Report formatters for `BenchComparison`. Three formats: JSON (machine), Markdown (PR
//! comments), Console (colored) — mirrors `eval::report` / `quality::report`'s structure
//! (IR-038 Step 6).

use super::BenchComparison;

pub fn format_json(cmp: &BenchComparison) -> String {
    serde_json::to_string_pretty(cmp).unwrap_or_default()
}

pub fn format_markdown(cmp: &BenchComparison) -> String {
    let status_emoji = if cmp.gate_passed { "✅" } else { "❌" };
    let mut lines = vec![
        format!("## {status_emoji} Virage Bench Report"),
        String::new(),
        format!("**Corpus:** {}", cmp.result.corpus_path),
        format!("**Timestamp:** {}", cmp.result.timestamp),
        format!(
            "**Files:** {} | **Chunks:** {} | **Duration:** {}ms",
            cmp.result.files_processed, cmp.result.chunks_upserted, cmp.result.duration_ms
        ),
        format!(
            "**Throughput:** {:.2} docs/sec | {:.2} chunks/sec | {:.0} tokens/sec",
            cmp.result.docs_per_sec, cmp.result.chunks_per_sec, cmp.result.tokens_per_sec
        ),
    ];
    match (&cmp.previous, cmp.regression_pct) {
        (Some(prev), Some(pct)) => {
            lines.push(format!(
                "**Vs. previous run** ({:.2} docs/sec, {}): {:+.1}% (gate: ≤{:.0}% regression)",
                prev.docs_per_sec,
                prev.timestamp,
                -pct * 100.0,
                cmp.gate_threshold * 100.0
            ));
        }
        _ => lines.push(
            "**Vs. previous run:** no prior run for this corpus — nothing to compare.".to_string(),
        ),
    }
    lines.join("\n")
}

mod ansi {
    pub const RESET: &str = "\x1b[0m";
    pub const BOLD: &str = "\x1b[1m";
    pub const DIM: &str = "\x1b[2m";
    pub const GREEN: &str = "\x1b[32m";
    pub const RED: &str = "\x1b[31m";
}

pub fn format_console(cmp: &BenchComparison) -> String {
    let status_color = if cmp.gate_passed {
        ansi::GREEN
    } else {
        ansi::RED
    };
    let reset = ansi::RESET;
    let bold = ansi::BOLD;
    let dim = ansi::DIM;

    let mut lines = vec![
        String::new(),
        format!("{bold}Virage Bench Report — {}{reset}", cmp.result.corpus_path),
        format!(
            "  Files        : {}  |  Chunks: {}  |  Duration: {}ms",
            cmp.result.files_processed, cmp.result.chunks_upserted, cmp.result.duration_ms
        ),
        format!(
            "  Throughput   : {status_color}{:.2} docs/sec{reset}  |  {:.2} chunks/sec  |  {:.0} tokens/sec",
            cmp.result.docs_per_sec, cmp.result.chunks_per_sec, cmp.result.tokens_per_sec
        ),
    ];
    match (&cmp.previous, cmp.regression_pct) {
        (Some(prev), Some(pct)) => {
            lines.push(format!(
                "  Vs. previous : {dim}{:.2} docs/sec ({}){reset}  →  {status_color}{:+.1}%{reset} (gate: ≤{:.0}% regression)",
                prev.docs_per_sec,
                prev.timestamp,
                -pct * 100.0,
                cmp.gate_threshold * 100.0
            ));
        }
        _ => lines.push(format!(
            "  Vs. previous : {dim}no prior run for this corpus — nothing to compare{reset}"
        )),
    }
    lines.push(String::new());
    lines.join("\n")
}
