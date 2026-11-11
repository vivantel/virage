//! Report formatters for `EvalReport` and `BootstrapResult`. Three formats: JSON (machine),
//! Markdown (PR comments), Console (colored table). Mirrors `quality::report`'s structure —
//! IR-038 Step 5.

use super::statistics::BootstrapResult;
use super::EvalReport;

pub fn format_json(report: &EvalReport) -> String {
    serde_json::to_string_pretty(report).unwrap_or_default()
}

pub fn format_compare_json(result: &BootstrapResult) -> String {
    serde_json::to_string_pretty(result).unwrap_or_default()
}

pub fn format_markdown(report: &EvalReport) -> String {
    let status_emoji = if report.gate_passed { "✅" } else { "❌" };
    let mut lines = vec![
        format!("## {status_emoji} Virage Eval Report"),
        String::new(),
        format!("**Dataset:** {}", report.dataset),
        format!(
            "**Macro MRR@{}:** {:.3} (gate: >{:.3})",
            report.top_k, report.macro_mrr_at_k, report.gate_threshold
        ),
        format!("**Timestamp:** {}", report.timestamp),
        format!(
            "**Queries:** {} | **Corpus docs:** {}",
            report.total_queries, report.total_corpus_docs
        ),
        String::new(),
        "| Subset | Queries | Corpus | MRR | NDCG | Recall | HitRate |".to_string(),
        "|--------|---------|--------|-----|------|--------|---------|".to_string(),
    ];
    for s in &report.subsets {
        lines.push(format!(
            "| {} | {} | {} | {:.3} | {:.3} | {:.3} | {:.3} |",
            s.subset,
            s.queries_evaluated,
            s.corpus_size,
            s.mrr_at_k,
            s.ndcg_at_k,
            s.recall_at_k,
            s.hit_rate_at_k
        ));
    }
    lines.join("\n")
}

pub fn format_compare_markdown(result: &BootstrapResult) -> String {
    let emoji = match result.recommendation {
        super::statistics::Recommendation::Accept => "✅",
        super::statistics::Recommendation::Reject => "❌",
        super::statistics::Recommendation::Inconclusive => "❓",
    };
    format!(
        "## {emoji} Eval Compare\n\n\
        **Baseline MRR:** {:.3}  \n\
        **Candidate MRR:** {:.3}  \n\
        **Delta:** {:+.3}  \n\
        **p-value:** {:.4}  \n\
        **95% CI:** [{:.3}, {:.3}]  \n\
        **Recommendation:** {:?}",
        result.baseline_mrr,
        result.candidate_mrr,
        result.mrr_delta,
        result.p_value,
        result.confidence_interval_95.0,
        result.confidence_interval_95.1,
        result.recommendation
    )
}

mod ansi {
    pub const RESET: &str = "\x1b[0m";
    pub const BOLD: &str = "\x1b[1m";
    pub const DIM: &str = "\x1b[2m";
    pub const GREEN: &str = "\x1b[32m";
    pub const RED: &str = "\x1b[31m";
}

pub fn format_console(report: &EvalReport) -> String {
    let status_color = if report.gate_passed {
        ansi::GREEN
    } else {
        ansi::RED
    };
    let reset = ansi::RESET;
    let bold = ansi::BOLD;
    let dim = ansi::DIM;

    let mut lines = vec![
        String::new(),
        format!("{bold}Virage Eval Report — {}{reset}", report.dataset),
        format!(
            "  Macro MRR@{} : {status_color}{:.3}{reset} (gate: >{:.3})",
            report.top_k, report.macro_mrr_at_k, report.gate_threshold
        ),
        format!(
            "  Queries      : {}  |  Corpus docs: {}",
            report.total_queries, report.total_corpus_docs
        ),
        format!("  Duration     : {}ms", report.duration_ms),
        String::new(),
        format!(
            "  {bold}{:<14} {:<8} {:<8} {:<8} {:<8} {:<8}{reset}",
            "SUBSET", "QUERIES", "MRR", "NDCG", "RECALL", "HITRATE"
        ),
        format!("  {}", "─".repeat(64)),
    ];
    for s in &report.subsets {
        lines.push(format!(
            "  {:<14} {:<8} {dim}{:<8.3}{reset} {dim}{:<8.3}{reset} {dim}{:<8.3}{reset} {dim}{:<8.3}{reset}",
            s.subset, s.queries_evaluated, s.mrr_at_k, s.ndcg_at_k, s.recall_at_k, s.hit_rate_at_k
        ));
    }
    lines.push(String::new());
    lines.join("\n")
}

pub fn format_compare_console(result: &BootstrapResult) -> String {
    let color = match result.recommendation {
        super::statistics::Recommendation::Accept => ansi::GREEN,
        super::statistics::Recommendation::Reject => ansi::RED,
        super::statistics::Recommendation::Inconclusive => ansi::DIM,
    };
    let reset = ansi::RESET;
    let bold = ansi::BOLD;
    format!(
        "\n{bold}Eval Compare{reset}\n\
        \x20 Baseline MRR  : {:.3}\n\
        \x20 Candidate MRR : {:.3}\n\
        \x20 Delta         : {:+.3}\n\
        \x20 p-value       : {:.4}\n\
        \x20 95% CI        : [{:.3}, {:.3}]\n\
        \x20 Recommendation: {color}{bold}{:?}{reset}\n",
        result.baseline_mrr,
        result.candidate_mrr,
        result.mrr_delta,
        result.p_value,
        result.confidence_interval_95.0,
        result.confidence_interval_95.1,
        result.recommendation
    )
}
