//! `benchmark-action`/`github-action-benchmark`-compatible feed, shared across every
//! history-backed command. Ported from `dist/quality/history.js`'s `benchmark-data.json`
//! output, generalized so `quality run`, `eval run`, and `bench index` can each contribute
//! points to the same feed without clobbering each other's entries.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkPoint {
    pub name: String,
    pub unit: String,
    pub value: f64,
    pub bigger_is_better: bool,
}

impl BenchmarkPoint {
    pub fn new(name: impl Into<String>, unit: impl Into<String>, value: f64) -> Self {
        Self {
            name: name.into(),
            unit: unit.into(),
            value,
            bigger_is_better: true,
        }
    }
}

/// A record that can contribute points to the shared benchmark feed.
pub trait ToBenchmarkPoints {
    fn to_benchmark_points(&self) -> Vec<BenchmarkPoint>;
}

const FILE_NAME: &str = "benchmark-data.json";

/// Merges `points` into `<historyDir>/benchmark-data.json`: replaces any existing point with
/// the same `name`, appends new ones, leaves points from other commands untouched. A missing or
/// unparseable existing file starts fresh rather than erroring.
pub fn upsert(history_dir: &Path, points: &[BenchmarkPoint]) -> anyhow::Result<()> {
    std::fs::create_dir_all(history_dir)?;
    let path = history_dir.join(FILE_NAME);
    let mut existing: Vec<BenchmarkPoint> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    for point in points {
        if let Some(slot) = existing.iter_mut().find(|p| p.name == point.name) {
            *slot = point.clone();
        } else {
            existing.push(point.clone());
        }
    }

    std::fs::write(&path, serde_json::to_string_pretty(&existing)?)
        .map_err(|e| anyhow::anyhow!("Cannot write {path:?}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "virage-benchmark-data-test-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn upsert_creates_file_with_points() {
        let dir = tmp_dir("create");
        upsert(
            &dir,
            &[BenchmarkPoint::new("Overall Quality", "score", 0.8)],
        )
        .unwrap();
        let raw = std::fs::read_to_string(dir.join(FILE_NAME)).unwrap();
        let points: Vec<BenchmarkPoint> = serde_json::from_str(&raw).unwrap();
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].name, "Overall Quality");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn upsert_replaces_same_name_and_preserves_others() {
        let dir = tmp_dir("merge");
        upsert(
            &dir,
            &[BenchmarkPoint::new("Overall Quality", "score", 0.8)],
        )
        .unwrap();
        upsert(
            &dir,
            &[BenchmarkPoint::new("Eval Macro MRR@10", "score", 0.5)],
        )
        .unwrap();
        upsert(
            &dir,
            &[BenchmarkPoint::new("Overall Quality", "score", 0.9)],
        )
        .unwrap();

        let raw = std::fs::read_to_string(dir.join(FILE_NAME)).unwrap();
        let points: Vec<BenchmarkPoint> = serde_json::from_str(&raw).unwrap();
        assert_eq!(points.len(), 2);
        let quality = points.iter().find(|p| p.name == "Overall Quality").unwrap();
        assert_eq!(quality.value, 0.9);
        assert!(points.iter().any(|p| p.name == "Eval Macro MRR@10"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
