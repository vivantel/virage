//! Report formatters for `QualityReport`. Three formats: JSON (machine), Markdown (PR
//! comments), Console (colored table). Ported from `dist/quality/report.js` — IR-038.

use super::QualityReport;

pub fn format_json(report: &QualityReport) -> String {
    serde_json::to_string_pretty(report).unwrap_or_default()
}

pub fn format_markdown(report: &QualityReport) -> String {
    let status_emoji = if report.status.is_pass() {
        "✅"
    } else {
        "❌"
    };
    let score_percent = report.overall_score * 100.0;
    let mut lines = vec![
        format!("## {status_emoji} Virage Quality Report"),
        String::new(),
        format!(
            "**Overall Score:** {score_percent:.1}% — **{}**  ",
            report.status
        ),
        format!("**Timestamp:** {}  ", report.timestamp),
        format!(
            "**Sample Size:** {} chunks | **Top-K:** {}",
            report.sample_size, report.top_k
        ),
        String::new(),
    ];

    let failed_gates: Vec<_> = report
        .must_pass_gates
        .iter()
        .filter(|g| !g.passed)
        .collect();
    if !failed_gates.is_empty() {
        lines.push("### ⚠️ Must-Pass Failures".to_string());
        lines.push(String::new());
        lines.push("| Metric | Value | Threshold | Status |".to_string());
        lines.push("|--------|-------|-----------|--------|".to_string());
        for gate in &failed_gates {
            lines.push(format!(
                "| {} | {:.3} | >{} | ❌ FAIL |",
                gate.metric_name, gate.value, gate.threshold
            ));
        }
        lines.push(String::new());
    }

    lines.push("### Component Scores".to_string());
    lines.push(String::new());
    lines.push("| Component | Score | Status |".to_string());
    lines.push("|-----------|-------|--------|".to_string());
    for comp in &report.components {
        if comp.skipped {
            lines.push(format!("| {} | — | ⏭ skipped |", comp.label));
        } else {
            let score_str = format!("{:.1}%", comp.score * 100.0);
            let emoji = if comp.score >= 0.7 {
                "🟢"
            } else if comp.score >= 0.5 {
                "🟡"
            } else {
                "🔴"
            };
            lines.push(format!("| {} | {score_str} | {emoji} |", comp.label));
        }
    }
    lines.push(String::new());

    lines.push("<details>".to_string());
    lines.push("<summary>Metric Details</summary>".to_string());
    lines.push(String::new());
    for comp in &report.components {
        if comp.skipped {
            continue;
        }
        lines.push(format!("#### {}", comp.label));
        lines.push(String::new());
        lines.push("| Metric | Raw | Normalized | Weight | Status |".to_string());
        lines.push("|--------|-----|------------|--------|--------|".to_string());
        for m in &comp.metrics {
            if m.skipped {
                lines.push(format!(
                    "| {} | — | — | {} | ⏭ {} |",
                    m.name,
                    m.weight,
                    m.skip_reason.as_deref().unwrap_or("skipped")
                ));
            } else {
                let must_pass = if m.must_pass {
                    if m.must_pass_passed == Some(true) {
                        " ✅"
                    } else {
                        " ❌ MUST-PASS FAIL"
                    }
                } else {
                    ""
                };
                lines.push(format!(
                    "| {} | {:.3} | {:.1}% | {} | —{must_pass} |",
                    m.name,
                    m.raw_value,
                    m.normalized_value * 100.0,
                    m.weight
                ));
            }
        }
        lines.push(String::new());
    }
    lines.push("</details>".to_string());
    lines.join("\n")
}

mod ansi {
    pub const RESET: &str = "\x1b[0m";
    pub const BOLD: &str = "\x1b[1m";
    pub const DIM: &str = "\x1b[2m";
    pub const GREEN: &str = "\x1b[32m";
    pub const YELLOW: &str = "\x1b[33m";
    pub const RED: &str = "\x1b[31m";
}

fn score_color(score: f64) -> &'static str {
    if score >= 0.7 {
        ansi::GREEN
    } else if score >= 0.5 {
        ansi::YELLOW
    } else {
        ansi::RED
    }
}

fn bar(score: f64, width: usize) -> String {
    let filled = (score * width as f64).round().max(0.0) as usize;
    let filled = filled.min(width);
    format!("{}{}", "█".repeat(filled), "░".repeat(width - filled))
}

pub fn format_console(report: &QualityReport) -> String {
    let status_color = if report.status.is_pass() {
        ansi::GREEN
    } else {
        ansi::RED
    };
    let score_percent = report.overall_score * 100.0;
    let reset = ansi::RESET;
    let bold = ansi::BOLD;
    let dim = ansi::DIM;

    let mut lines = vec![
        String::new(),
        format!("{bold}╔════════════════════════════════════════════════════╗{reset}"),
        format!("{bold}║            Virage Quality Report                   ║{reset}"),
        format!("{bold}╚════════════════════════════════════════════════════╝{reset}"),
        String::new(),
        format!(
            "  Status      : {status_color}{bold}{}{reset}",
            report.status
        ),
        format!(
            "  Score       : {}{score_percent:.1}%{reset}  {}",
            score_color(report.overall_score),
            bar(report.overall_score, 20)
        ),
        format!(
            "  Sample size : {} chunks  |  Top-K: {}",
            report.sample_size, report.top_k
        ),
        format!("  Duration    : {}ms", report.duration_ms),
        String::new(),
    ];

    let failed_gates: Vec<_> = report
        .must_pass_gates
        .iter()
        .filter(|g| !g.passed)
        .collect();
    if !failed_gates.is_empty() {
        lines.push(format!("  {}{bold}⚠ Must-Pass Failures{reset}", ansi::RED));
        for gate in &failed_gates {
            lines.push(format!(
                "  {}✗ {}: {:.3} (threshold: >{}){reset}",
                ansi::RED,
                gate.metric_name,
                gate.value,
                gate.threshold
            ));
        }
        lines.push(String::new());
    }

    lines.push(format!(
        "  {bold}{:<22} {:<8} BAR{reset}",
        "COMPONENT", "SCORE"
    ));
    lines.push(format!("  {}", "─".repeat(52)));
    for comp in &report.components {
        if comp.skipped {
            lines.push(format!("  {:<22} {dim}skipped{reset}", comp.label));
            continue;
        }
        let score_str = format!("{:.1}%", comp.score * 100.0);
        let color = score_color(comp.score);
        lines.push(format!(
            "  {:<22} {color}{:<8}{reset} {}",
            comp.label,
            score_str,
            bar(comp.score, 18)
        ));
        for m in &comp.metrics {
            if m.must_pass && !m.skipped {
                let icon = if m.must_pass_passed == Some(true) {
                    format!("{}✓", ansi::GREEN)
                } else {
                    format!("{}✗", ansi::RED)
                };
                lines.push(format!(
                    "  {dim}  └─ {}: {:.3}{reset} {icon}{reset}",
                    m.name, m.raw_value
                ));
            }
        }
    }
    lines.push(format!("  {}", "─".repeat(52)));
    lines.push(format!(
        "  {:<22} {}{score_percent:.1}%{reset} {}",
        "OVERALL",
        score_color(report.overall_score),
        bar(report.overall_score, 18)
    ));
    lines.push(String::new());
    lines.join("\n")
}
