//! Shared run-history store (IR-038 Step 7). `quality run`, `eval run`/`compare`, and
//! `bench index` all persist through this one store instead of three separate ad hoc formats
//! (superseding `bench`'s Step 6 provisional `.virage/bench-history.json` and `eval compare`'s
//! Step 5 provisional file-path baseline/candidate args). Ported from `dist/quality/history.js`'s
//! design — timestamped JSON per run, plus an optional `benchmark-action`-compatible feed
//! (`history::benchmark`) — generalized across commands via a `kind` subdirectory.
//!
//! Storage layout:
//!   <historyDir>/<kind>/<id>-<kind>.json   — one full record per run, `kind` = "quality" |
//!                                             "eval" | "bench"
//!   <historyDir>/benchmark-data.json       — merged benchmark-action feed, latest value per
//!                                             point name (see `history::benchmark`)

pub mod benchmark;

use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

pub const DEFAULT_HISTORY_DIR: &str = ".virage/history";

/// Hard cap on stored runs per kind, so the store doesn't grow unbounded across CI runs over a
/// project's lifetime. Oldest entries are dropped first.
const MAX_RUNS_PER_KIND: usize = 100;

/// UTC `YYYY-MM-DDTHH:MM:SSZ` timestamp. Single implementation shared by every history-backed
/// report (`quality::QualityReport`, `eval::EvalReport`, `bench::BenchResult`) — previously
/// hand-duplicated three times before this module existed.
pub fn timestamp_now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let time_of_day = secs.rem_euclid(86_400);
    let (hour, minute, second) = (
        time_of_day / 3600,
        (time_of_day / 60) % 60,
        time_of_day % 60,
    );

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Sanitizes an ISO timestamp into a filesystem- and CLI-arg-safe history id. Sanitization
/// preserves lexicographic order (fixed-width substitution), so string-sorting ids also sorts
/// runs chronologically — same trick the JS predecessor used.
pub fn id_from_timestamp(timestamp: &str) -> String {
    timestamp.replace([':', '.'], "-")
}

fn kind_dir(history_dir: &Path, kind: &str) -> PathBuf {
    history_dir.join(kind)
}

fn record_path(history_dir: &Path, kind: &str, id: &str) -> PathBuf {
    kind_dir(history_dir, kind).join(format!("{id}-{kind}.json"))
}

/// Persists `record` under `kind`, returning its history id (derived from `timestamp`).
pub fn save<T: Serialize>(
    history_dir: &Path,
    kind: &str,
    timestamp: &str,
    record: &T,
) -> anyhow::Result<String> {
    let dir = kind_dir(history_dir, kind);
    std::fs::create_dir_all(&dir)?;
    let id = id_from_timestamp(timestamp);
    let path = record_path(history_dir, kind, &id);
    std::fs::write(&path, serde_json::to_string_pretty(record)?)
        .map_err(|e| anyhow::anyhow!("Cannot write history record {path:?}: {e}"))?;
    prune(history_dir, kind, MAX_RUNS_PER_KIND)?;
    Ok(id)
}

/// History ids for `kind`, most recent first. A missing directory is treated as no history yet
/// (first-ever run), not an error.
pub fn list_ids(history_dir: &Path, kind: &str) -> Vec<String> {
    let dir = kind_dir(history_dir, kind);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let suffix = format!("-{kind}.json");
    let mut ids: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter_map(|f| f.strip_suffix(&suffix).map(|id| id.to_string()))
        .collect();
    ids.sort();
    ids.reverse();
    ids
}

/// Loads the record for `kind`/`id`. A missing or unparseable file returns `None` rather than
/// erroring — callers decide whether an absent history entry is fatal.
pub fn load<T: DeserializeOwned>(history_dir: &Path, kind: &str, id: &str) -> Option<T> {
    let text = std::fs::read_to_string(record_path(history_dir, kind, id)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Most recent record for `kind`, if any.
pub fn load_latest<T: DeserializeOwned>(history_dir: &Path, kind: &str) -> Option<T> {
    list_ids(history_dir, kind)
        .into_iter()
        .find_map(|id| load(history_dir, kind, &id))
}

/// Most recent record for `kind` satisfying `predicate` — e.g. `bench index`'s "last run for
/// this corpus path" lookup, which a flat "most recent overall" wouldn't answer.
pub fn load_latest_where<T: DeserializeOwned>(
    history_dir: &Path,
    kind: &str,
    predicate: impl Fn(&T) -> bool,
) -> Option<T> {
    list_ids(history_dir, kind)
        .into_iter()
        .find_map(|id| load::<T>(history_dir, kind, &id).filter(|r| predicate(r)))
}

/// Resolves a CLI-supplied history reference: the literal `"latest"`, a bare history id (as
/// printed by the producing command), or a raw ISO timestamp (sanitized to an id). Kept
/// permissive because human-format output prints the raw `timestamp` field, not the sanitized
/// id, and users copy whichever they see.
pub fn resolve_ref<T: DeserializeOwned>(
    history_dir: &Path,
    kind: &str,
    reference: &str,
) -> Option<T> {
    if reference == "latest" {
        return load_latest(history_dir, kind);
    }
    load(history_dir, kind, reference)
        .or_else(|| load(history_dir, kind, &id_from_timestamp(reference)))
}

/// Drops the oldest entries for `kind` beyond `max_runs`.
fn prune(history_dir: &Path, kind: &str, max_runs: usize) -> anyhow::Result<()> {
    let mut ids = list_ids(history_dir, kind);
    if ids.len() <= max_runs {
        return Ok(());
    }
    for id in ids.split_off(max_runs) {
        let _ = std::fs::remove_file(record_path(history_dir, kind, &id));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    struct Rec {
        timestamp: String,
        key: String,
        value: f64,
    }

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("virage-history-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn missing_kind_dir_is_empty_history() {
        let dir = tmp_dir("missing");
        assert!(list_ids(&dir, "quality").is_empty());
        assert!(load_latest::<Rec>(&dir, "quality").is_none());
    }

    #[test]
    fn save_load_and_list_roundtrip() {
        let dir = tmp_dir("roundtrip");
        let r1 = Rec {
            timestamp: "2026-07-30T10:00:00Z".into(),
            key: "a".into(),
            value: 1.0,
        };
        let r2 = Rec {
            timestamp: "2026-07-30T11:00:00Z".into(),
            key: "b".into(),
            value: 2.0,
        };
        let id1 = save(&dir, "eval", &r1.timestamp, &r1).unwrap();
        let id2 = save(&dir, "eval", &r2.timestamp, &r2).unwrap();

        let ids = list_ids(&dir, "eval");
        assert_eq!(ids, vec![id2.clone(), id1.clone()]);

        let loaded1: Rec = load(&dir, "eval", &id1).unwrap();
        assert_eq!(loaded1, r1);

        let latest: Rec = load_latest(&dir, "eval").unwrap();
        assert_eq!(latest, r2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_latest_where_finds_first_match_scanning_newest_first() {
        let dir = tmp_dir("latest-where");
        let a1 = Rec {
            timestamp: "2026-07-30T09:00:00Z".into(),
            key: "corpus-a".into(),
            value: 10.0,
        };
        let b1 = Rec {
            timestamp: "2026-07-30T10:00:00Z".into(),
            key: "corpus-b".into(),
            value: 20.0,
        };
        let a2 = Rec {
            timestamp: "2026-07-30T11:00:00Z".into(),
            key: "corpus-a".into(),
            value: 30.0,
        };
        save(&dir, "bench", &a1.timestamp, &a1).unwrap();
        save(&dir, "bench", &b1.timestamp, &b1).unwrap();
        save(&dir, "bench", &a2.timestamp, &a2).unwrap();

        let found: Rec = load_latest_where(&dir, "bench", |r: &Rec| r.key == "corpus-a").unwrap();
        assert_eq!(found, a2);

        assert!(load_latest_where(&dir, "bench", |r: &Rec| r.key == "corpus-c").is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_ref_handles_latest_id_and_raw_timestamp() {
        let dir = tmp_dir("resolve-ref");
        let r = Rec {
            timestamp: "2026-07-30T12:34:56Z".into(),
            key: "x".into(),
            value: 5.0,
        };
        let id = save(&dir, "quality", &r.timestamp, &r).unwrap();

        assert_eq!(
            resolve_ref::<Rec>(&dir, "quality", "latest"),
            Some(r.clone())
        );
        assert_eq!(resolve_ref::<Rec>(&dir, "quality", &id), Some(r.clone()));
        assert_eq!(
            resolve_ref::<Rec>(&dir, "quality", &r.timestamp),
            Some(r.clone())
        );
        assert_eq!(resolve_ref::<Rec>(&dir, "quality", "nope"), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_drops_oldest_beyond_cap() {
        let dir = tmp_dir("prune");
        for i in 0..(MAX_RUNS_PER_KIND + 5) {
            let r = Rec {
                timestamp: format!("2026-07-30T{:02}:00:00Z", i % 24),
                key: format!("run-{i}"),
                value: i as f64,
            };
            // Distinct ids even when the hour wraps: fold the index into the id via key, since
            // the id is derived purely from `timestamp` — use a unique timestamp per run instead.
            let ts = format!("2026-07-{:02}T00:00:{:02}Z", 1 + (i / 60) % 28, i % 60);
            save(&dir, "bench", &ts, &r).unwrap();
        }
        assert_eq!(list_ids(&dir, "bench").len(), MAX_RUNS_PER_KIND);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
