//! shields.io-compatible badge JSON for `virage quality run`, ported from
//! `dist/quality/history.js`'s `makeQualityBadge`. Written to
//! `<historyDir>/quality/badge.json` on every `quality run` — quality-specific (no JS-predecessor
//! precedent existed for a bench/eval badge), so this stays local to the `quality` module rather
//! than living in the shared `history` module.

use std::path::Path;

use serde::Serialize;

use super::QualityStatus;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Badge {
    pub schema_version: u8,
    pub label: String,
    pub message: String,
    pub color: &'static str,
}

pub fn make(overall_score: f64, status: QualityStatus) -> Badge {
    let percent = (overall_score * 100.0).round() as i64;
    let color = if !status.is_pass() {
        "red"
    } else if percent >= 80 {
        "brightgreen"
    } else if percent >= 70 {
        "green"
    } else if percent >= 55 {
        "yellow"
    } else {
        "orange"
    };
    Badge {
        schema_version: 1,
        label: "quality".to_string(),
        message: format!("{percent}%"),
        color,
    }
}

pub fn write(history_dir: &Path, overall_score: f64, status: QualityStatus) -> anyhow::Result<()> {
    let dir = history_dir.join("quality");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("badge.json");
    let badge = make(overall_score, status);
    std::fs::write(&path, serde_json::to_string_pretty(&badge)?)
        .map_err(|e| anyhow::anyhow!("Cannot write {path:?}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fail_status_is_always_red() {
        let b = make(0.95, QualityStatus::Fail);
        assert_eq!(b.color, "red");
    }

    #[test]
    fn pass_status_colors_by_score_band() {
        assert_eq!(make(0.85, QualityStatus::Pass).color, "brightgreen");
        assert_eq!(make(0.75, QualityStatus::Pass).color, "green");
        assert_eq!(make(0.60, QualityStatus::Pass).color, "yellow");
        assert_eq!(make(0.40, QualityStatus::Pass).color, "orange");
    }
}
