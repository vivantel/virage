//! Retrieval contract v0 — the project-side files a host tool and a retrieval tool exchange.
//!
//! Nothing here is specific to a single host: the paths and field names come from the contract.
//! Mirrors `packages/virage-core/src/retrieval-contract.ts`, which the TypeScript CLI uses.

use std::path::{Path, PathBuf};

#[cfg(feature = "pipeline")]
pub mod policy;

/// The integer contract version this build meets.
pub const CONTRACT_VERSION: u64 = 0;

/// Tool id used in the declaration and endpoint file names.
pub const TOOL_ID: &str = "virage";

/// Project-relative POSIX path of the host-owned index policy.
pub const POLICY_PATH: &str = ".go-getter/retrieval/policy.json";

/// Project-relative POSIX directory holding the declaration.
pub const DECLARATION_DIR: &str = ".go-getter/retrieval";

/// True only if every file is scanned for secrets before it is indexed and files with findings
/// are skipped. Keep in step with the indexing pipeline.
pub const PRE_INDEX_SECRET_SCAN: bool = false;

/// Version reported in the declaration: the version of this binary.
pub fn tool_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn policy_path(project_dir: &Path) -> PathBuf {
    project_dir.join(POLICY_PATH)
}

pub fn declaration_path(project_dir: &Path) -> PathBuf {
    project_dir
        .join(DECLARATION_DIR)
        .join(format!("{TOOL_ID}.json"))
}

/// Whether conformance mode is on for a project.
///
/// An explicit boolean `retrieval.conformance` in the config file wins either way. When it is
/// absent (or the config is missing/unparseable), the mode is on if the host has written a policy
/// file.
pub fn is_conformance_mode(project_dir: &Path, config_path: &Path) -> bool {
    if let Ok(raw) = std::fs::read_to_string(config_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(flag) = v
                .get("retrieval")
                .and_then(|r| r.get("conformance"))
                .and_then(|c| c.as_bool())
            {
                return flag;
            }
        }
    }
    policy_path(project_dir).exists()
}

pub fn declaration_json(tool_version: &str) -> serde_json::Value {
    serde_json::json!({
        "contractVersion": CONTRACT_VERSION,
        "tool": TOOL_ID,
        "toolVersion": tool_version,
        "preIndexSecretScan": PRE_INDEX_SECRET_SCAN,
        "registersHostConfig": false,
    })
}

/// Write the declaration file. Idempotent: returns `Ok(false)` when the file already has the same
/// content.
pub fn write_declaration(project_dir: &Path, tool_version: &str) -> std::io::Result<bool> {
    let path = declaration_path(project_dir);
    let mut content = serde_json::to_string_pretty(&declaration_json(tool_version))
        .map_err(std::io::Error::other)?;
    content.push('\n');
    if std::fs::read_to_string(&path).is_ok_and(|existing| existing == content) {
        return Ok(false);
    }
    std::fs::create_dir_all(project_dir.join(DECLARATION_DIR))?;
    std::fs::write(&path, content)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "virage-retrieval-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn declaration_has_contract_fields() {
        let v = declaration_json("1.2.3");
        assert_eq!(v["contractVersion"], 0);
        assert_eq!(v["tool"], "virage");
        assert_eq!(v["toolVersion"], "1.2.3");
        assert_eq!(v["preIndexSecretScan"], PRE_INDEX_SECRET_SCAN);
        assert_eq!(v["registersHostConfig"], false);
    }

    #[test]
    fn write_declaration_is_idempotent() {
        let dir = tmp("decl");
        assert!(write_declaration(&dir, "1.0.0").unwrap());
        assert!(!write_declaration(&dir, "1.0.0").unwrap());
        assert!(write_declaration(&dir, "1.0.1").unwrap());
        let raw = std::fs::read_to_string(declaration_path(&dir)).unwrap();
        assert!(raw.contains("\"toolVersion\": \"1.0.1\""));
    }

    #[test]
    fn mode_off_without_config_or_policy() {
        let dir = tmp("off");
        assert!(!is_conformance_mode(&dir, &dir.join("virage.config.json")));
    }

    #[test]
    fn mode_on_when_policy_exists() {
        let dir = tmp("auto");
        std::fs::create_dir_all(dir.join(DECLARATION_DIR)).unwrap();
        std::fs::write(policy_path(&dir), "{}").unwrap();
        assert!(is_conformance_mode(&dir, &dir.join("virage.config.json")));
    }

    #[test]
    fn explicit_flag_wins_over_policy_file() {
        let dir = tmp("flag");
        std::fs::create_dir_all(dir.join(DECLARATION_DIR)).unwrap();
        std::fs::write(policy_path(&dir), "{}").unwrap();
        let cfg = dir.join("virage.config.json");
        std::fs::write(&cfg, r#"{"retrieval":{"conformance":false}}"#).unwrap();
        assert!(!is_conformance_mode(&dir, &cfg));
        std::fs::write(&cfg, r#"{"retrieval":{"conformance":true}}"#).unwrap();
        assert!(is_conformance_mode(&dir, &cfg));
    }
}
