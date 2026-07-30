//! Local run-history persistence for `virage bench index` (IR-038 Step 6, provisional — see
//! `bench` module docs). One JSON array of `BenchResult`, keyed by `corpus_path`, at
//! `.virage/bench-history.json`.

use std::path::Path;

use super::BenchResult;

/// Default history file location, matching the `.virage/virage.db` convention
/// (`config::default_db_path`).
pub const DEFAULT_HISTORY_PATH: &str = ".virage/bench-history.json";

/// Hard cap on stored runs (across all corpus paths) to keep the file from growing unbounded
/// across CI runs over the project's lifetime. Oldest entries are dropped first.
const MAX_HISTORY_ENTRIES: usize = 500;

/// Loads the full history array. A missing or unparseable file is treated as empty history
/// (first-ever run), not an error — this file is a local cache, not a source of truth.
pub fn load(path: &Path) -> Vec<BenchResult> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

/// The most recent recorded run for `corpus_path`, if any. Entries are stored in append order,
/// so the last matching entry is the most recent.
pub fn last_for_corpus(history: &[BenchResult], corpus_path: &str) -> Option<BenchResult> {
    history
        .iter()
        .rev()
        .find(|r| r.corpus_path == corpus_path)
        .cloned()
}

/// Appends `result` to the history file at `path`, creating the parent directory and file if
/// needed, and trims to `MAX_HISTORY_ENTRIES`.
pub fn append(path: &Path, result: &BenchResult) -> anyhow::Result<()> {
    let mut history = load(path);
    history.push(result.clone());
    if history.len() > MAX_HISTORY_ENTRIES {
        let drop = history.len() - MAX_HISTORY_ENTRIES;
        history.drain(0..drop);
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let json = serde_json::to_string_pretty(&history)?;
    std::fs::write(path, json)
        .map_err(|e| anyhow::anyhow!("Cannot write bench history {path:?}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(corpus_path: &str, docs_per_sec: f64) -> BenchResult {
        BenchResult {
            timestamp: "2026-07-30T00:00:00Z".into(),
            corpus_path: corpus_path.into(),
            files_processed: 10,
            chunks_upserted: 40,
            tokens_processed: 4000,
            duration_ms: 1000,
            docs_per_sec,
            chunks_per_sec: 40.0,
            tokens_per_sec: 4000.0,
        }
    }

    #[test]
    fn missing_file_is_empty_history() {
        let dir = std::env::temp_dir().join(format!("bench-history-test-{}", std::process::id()));
        assert!(load(&dir.join("does-not-exist.json")).is_empty());
    }

    #[test]
    fn append_then_last_for_corpus_roundtrips() {
        let dir = std::env::temp_dir().join(format!(
            "bench-history-test-{}-{}",
            std::process::id(),
            "roundtrip"
        ));
        let path = dir.join("bench-history.json");
        let _ = std::fs::remove_file(&path);

        append(&path, &result("/a", 100.0)).unwrap();
        append(&path, &result("/b", 50.0)).unwrap();
        append(&path, &result("/a", 110.0)).unwrap();

        let history = load(&path);
        assert_eq!(history.len(), 3);
        let last_a = last_for_corpus(&history, "/a").unwrap();
        assert_eq!(last_a.docs_per_sec, 110.0);
        let last_b = last_for_corpus(&history, "/b").unwrap();
        assert_eq!(last_b.docs_per_sec, 50.0);
        assert!(last_for_corpus(&history, "/c").is_none());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn trims_to_max_entries() {
        let dir = std::env::temp_dir().join(format!(
            "bench-history-test-{}-{}",
            std::process::id(),
            "trim"
        ));
        let path = dir.join("bench-history.json");
        let _ = std::fs::remove_file(&path);

        for i in 0..(MAX_HISTORY_ENTRIES + 10) {
            append(&path, &result("/a", i as f64)).unwrap();
        }
        let history = load(&path);
        assert_eq!(history.len(), MAX_HISTORY_ENTRIES);
        // Oldest entries were dropped — the last entry should be the final append.
        assert_eq!(
            history.last().unwrap().docs_per_sec,
            (MAX_HISTORY_ENTRIES + 9) as f64
        );

        let _ = std::fs::remove_file(&path);
    }
}
