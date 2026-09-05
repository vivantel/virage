//! Shared helpers used by more than one `cli` command module.

use std::collections::HashMap;
use std::path::Path;

use indicatif::{ProgressBar, ProgressStyle};

use crate::config::{default_db_path, find_config, VirageConfigJson};
use crate::db::VirageDb;

pub(crate) fn resolve_config_path(arg: &str) -> anyhow::Result<String> {
    if !arg.is_empty() {
        return Ok(arg.to_string());
    }
    // VIRAGE_CONFIG lets a personal/uncommitted config (e.g. a gitignored .virage/*.json
    // pointing at a private store) take effect without editing the project's own committed
    // config or passing --config on every invocation — notably including MCP server
    // subprocesses, which never pass --config themselves (see packages/virage-agent-claude's
    // server.ts). Checked before find_config()'s committed-file convention so a personal
    // override always wins over whatever's checked in, but an explicit --config still wins
    // over both.
    if let Ok(path) = std::env::var("VIRAGE_CONFIG") {
        if !path.is_empty() {
            return Ok(path);
        }
    }
    find_config().ok_or_else(|| {
        anyhow::anyhow!(
            "No config found. Tried: {:?}. Run `virage init` to create one.",
            crate::config::CONFIG_CANDIDATES
        )
    })
}

pub(crate) fn resolve_db_path(arg: &str) -> String {
    if arg.is_empty() {
        default_db_path()
    } else {
        arg.to_string()
    }
}

pub(crate) fn open_or_init_db(path: &str) -> anyhow::Result<VirageDb> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    VirageDb::open(p).map_err(|e| anyhow::anyhow!("Cannot open state DB {:?}: {e}", path))
}

pub(crate) fn embedder_dims(cfg: &VirageConfigJson) -> usize {
    cfg.providers
        .embedder
        .usize_opt("dimensions")
        .unwrap_or(384)
}

pub(crate) fn spinner(msg: &str) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("{spinner:.cyan} {msg}")
            .unwrap()
            .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]),
    );
    pb.set_message(msg.to_string());
    pb.enable_steady_tick(std::time::Duration::from_millis(80));
    pb
}

pub(crate) fn virage_render_config() -> inquire::ui::RenderConfig<'static> {
    use inquire::ui::{Color, RenderConfig, StyleSheet, Styled};
    RenderConfig::default_colored()
        .with_highlighted_option_prefix(Styled::new("❯ ").with_fg(Color::DarkCyan))
        .with_selected_option(Some(StyleSheet::new().with_fg(Color::DarkCyan)))
        .with_selected_checkbox(Styled::new("[✓]").with_fg(Color::DarkGreen))
        .with_unselected_checkbox(Styled::new("[ ]").with_fg(Color::DarkGrey))
}

/// Runs a single-select step from a fixed list, mapped back to its index in `items`. `Esc` maps to
/// `Ok(None)` — the wizard's own "go back a step" signal (IR-040: back navigation via `Esc`, not a
/// `← Back` list item) — instead of propagating as an error. `Ctrl+C`
/// (`InquireError::OperationInterrupted`) still propagates via `?` for the existing top-level
/// cancellation handling (H14, below).
pub(crate) fn select_step(
    prompt: &str,
    items: &[&'static str],
    default: usize,
) -> anyhow::Result<Option<usize>> {
    use inquire::{InquireError, Select};
    match Select::new(prompt, items.to_vec())
        .with_starting_cursor(default)
        .with_render_config(virage_render_config())
        .prompt()
    {
        Ok(choice) => Ok(items.iter().position(|&i| i == choice)),
        Err(InquireError::OperationCanceled) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Runs a MultiSelect step over `items`, pre-checking `default_selected` indices. Returns the
/// selected indices into `items` on Enter, or `None` on `Esc` (back navigation). No prepended
/// control rows and no separate navigation prompt (IR-040) — `inquire` provides native bulk
/// selection (`→` select all, `←` select none) and confirms/cancels on the same screen.
pub(crate) fn multiselect_step(
    prompt: &str,
    items: &[String],
    default_selected: &[usize],
) -> anyhow::Result<Option<Vec<usize>>> {
    use inquire::{InquireError, MultiSelect};
    match MultiSelect::new(prompt, items.to_vec())
        .with_default(default_selected)
        .with_render_config(virage_render_config())
        .with_help_message("↑↓ move · Space toggle · → all · ← none · Enter confirm · Esc back")
        .raw_prompt()
    {
        Ok(picked) => Ok(Some(picked.into_iter().map(|o| o.index).collect())),
        Err(InquireError::OperationCanceled) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Scans `dir` for file types, returning a map of type name → file count.
/// Skips common non-source directories (node_modules, dist, target, etc.).
pub(crate) fn detect_file_types(dir: &Path) -> HashMap<&'static str, usize> {
    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    if !dir.exists() {
        return counts;
    }
    let skip = [
        "node_modules",
        "dist",
        "target",
        ".git",
        ".virage",
        "__pycache__",
        ".next",
        "build",
        "vendor",
    ];
    for entry in walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_entry(|e| {
            !e.file_type().is_dir() || !skip.contains(&e.file_name().to_str().unwrap_or(""))
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let ext = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let kind: &'static str = match ext {
            "ts" | "tsx" => "TypeScript",
            "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
            "py" => "Python",
            "rs" => "Rust",
            "go" => "Go",
            "java" | "kt" | "kts" => "Java / Kotlin",
            "cs" | "cpp" | "c" | "h" | "hpp" => "C# / C++",
            "md" | "mdx" => "Markdown",
            "pdf" => "PDF",
            "docx" => "Word / DOCX",
            "tex" => "LaTeX",
            _ => continue,
        };
        *counts.entry(kind).or_insert(0) += 1;
    }
    counts
}

/// File-type metadata: (key used by detect_file_types, display label, include patterns, chunker pkg)
pub(crate) const FILE_TYPE_META: &[(&str, &str, &[&str], &str)] = &[
    (
        "TypeScript",
        "TypeScript (.ts, .tsx)",
        &["**/*.ts", "**/*.tsx"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "JavaScript",
        "JavaScript (.js, .jsx, .mjs)",
        &["**/*.js", "**/*.jsx", "**/*.mjs"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "Python",
        "Python (.py)",
        &["**/*.py"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "Rust",
        "Rust (.rs)",
        &["**/*.rs"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "Go",
        "Go (.go)",
        &["**/*.go"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "Java / Kotlin",
        "Java / Kotlin (.java, .kt)",
        &["**/*.java", "**/*.kt"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "C# / C++",
        "C# / C++ (.cs, .cpp, .c)",
        &["**/*.cs", "**/*.cpp", "**/*.c"],
        "@vivantel/virage-chunker-ce-lang",
    ),
    (
        "Markdown",
        "Markdown (.md, .mdx)",
        &["**/*.md", "**/*.mdx"],
        "@vivantel/virage-chunker-ce-md",
    ),
    (
        "PDF",
        "PDF (.pdf)",
        &["**/*.pdf"],
        "@vivantel/virage-chunker-ce-pdf",
    ),
    (
        "Word / DOCX",
        "Word / DOCX (.docx)",
        &["**/*.docx"],
        "@vivantel/virage-chunker-ce-docx",
    ),
    (
        "LaTeX",
        "LaTeX (.tex)",
        &["**/*.tex"],
        "@vivantel/virage-chunker-ce-latex",
    ),
];

/// Exit codes reserved for `--ci` gate failures (IR-038). Each of `virage quality run`,
/// `virage eval run`/`compare`, and `virage bench index` exits its own code under `--ci` when a
/// must-pass metric or regression check fails; without `--ci`, the same failure prints as a
/// warning and the command exits 0.
#[allow(dead_code)]
pub(crate) mod ci_exit_codes {
    pub const QUALITY_GATE_FAILURE: i32 = 3;
    pub const EVAL_GATE_FAILURE: i32 = 4;
    pub const BENCH_GATE_FAILURE: i32 = 5;
}
