//! Index policy (retrieval contract v0, part a): `.go-getter/retrieval/policy.json`.
//!
//! Owned by the host; virage only reads it, before every index run and every query:
//!
//! - `ignore` globs (gitignore syntax) apply on top of `fileSets` include/ignore, for indexing and
//!   for query results;
//! - an embedder kind that `embedders` does not list is refused (`hosted` sends chunk text off the
//!   machine);
//! - fail closed: in conformance mode a missing file is a refusal; a file that is unreadable, has
//!   a missing or malformed field, or an unknown `contractVersion` is always a refusal.
//!
//! Errors carry a path or an embedder kind, never file contents.

use std::fmt;
use std::path::Path;

use globset::{Glob, GlobSet, GlobSetBuilder};

use crate::config::VirageConfigJson;

use super::{policy_path, CONTRACT_VERSION, POLICY_PATH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedderKind {
    /// Runs on this machine; no chunk text leaves it.
    Local,
    /// Sends chunk text off the machine.
    Hosted,
}

impl EmbedderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EmbedderKind::Local => "local",
            EmbedderKind::Hosted => "hosted",
        }
    }
}

/// Classify an embedder package. Only packages known to run on this machine are `Local`; anything
/// else is treated as `Hosted` (fail closed).
pub fn embedder_kind(package: &str) -> EmbedderKind {
    const LOCAL: [&str; 4] = [
        "embedder-onnx",
        "embedder-fastembed",
        "embedder-transformers",
        "embedder-dylib",
    ];
    if LOCAL.iter().any(|k| package.contains(k)) {
        EmbedderKind::Local
    } else {
        EmbedderKind::Hosted
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyError {
    /// The policy file does not exist (conformance mode requires it).
    Missing(String),
    /// The file exists but cannot be read or is not JSON.
    Unreadable(String),
    /// A required field is missing or has the wrong shape.
    Invalid { path: String, field: &'static str },
    /// `contractVersion` is not one this build meets.
    UnsupportedVersion(String),
    /// The configured embedder's kind is not listed in `embedders`.
    EmbedderNotAllowed(&'static str),
}

impl fmt::Display for PolicyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PolicyError::Missing(p) => {
                write!(
                    f,
                    "retrieval policy missing: {p} (required in conformance mode)"
                )
            }
            PolicyError::Unreadable(p) => write!(f, "retrieval policy unreadable: {p}"),
            PolicyError::Invalid { path, field } => {
                write!(f, "retrieval policy invalid: {path} (field `{field}`)")
            }
            PolicyError::UnsupportedVersion(p) => {
                write!(
                    f,
                    "retrieval policy has an unsupported contractVersion: {p}"
                )
            }
            PolicyError::EmbedderNotAllowed(kind) => write!(
                f,
                "refused: a {kind} embedder is not allowed by the retrieval policy ({POLICY_PATH})"
            ),
        }
    }
}

impl std::error::Error for PolicyError {}

#[derive(Debug, Clone)]
pub struct Policy {
    /// `ignore` globs converted to globset syntax (see [`gitignore_to_globs`]).
    pub ignore_globs: Vec<String>,
    pub allow_local: bool,
    pub allow_hosted: bool,
    pub data_class: String,
}

const DATA_CLASSES: [&str; 4] = ["public", "internal", "confidential", "restricted"];

impl Policy {
    /// Parse the policy JSON. `path` is only used in error messages.
    pub fn parse(raw: &str, path: &str) -> Result<Policy, PolicyError> {
        let v: serde_json::Value =
            serde_json::from_str(raw).map_err(|_| PolicyError::Unreadable(path.to_string()))?;
        let invalid = |field: &'static str| PolicyError::Invalid {
            path: path.to_string(),
            field,
        };

        match v.get("contractVersion") {
            Some(n) if n.is_u64() || n.is_i64() => {
                if n.as_u64() != Some(CONTRACT_VERSION) {
                    return Err(PolicyError::UnsupportedVersion(path.to_string()));
                }
            }
            _ => return Err(invalid("contractVersion")),
        }

        let ignore = v
            .get("ignore")
            .and_then(|a| a.as_array())
            .ok_or_else(|| invalid("ignore"))?;
        let mut ignore_globs = Vec::new();
        for entry in ignore {
            let pat = entry.as_str().ok_or_else(|| invalid("ignore"))?;
            ignore_globs.extend(gitignore_to_globs(pat));
        }

        let embedders = v
            .get("embedders")
            .and_then(|a| a.as_array())
            .ok_or_else(|| invalid("embedders"))?;
        let mut allow_local = false;
        let mut allow_hosted = false;
        for entry in embedders {
            // Unknown kinds grant nothing.
            match entry.as_str().ok_or_else(|| invalid("embedders"))? {
                "local" => allow_local = true,
                "hosted" => allow_hosted = true,
                _ => {}
            }
        }

        let data_class = v
            .get("dataClass")
            .and_then(|c| c.as_str())
            .filter(|c| DATA_CLASSES.contains(c))
            .ok_or_else(|| invalid("dataClass"))?
            .to_string();

        Ok(Policy {
            ignore_globs,
            allow_local,
            allow_hosted,
            data_class,
        })
    }

    /// Refuse an embedder whose kind `embedders` does not list.
    pub fn check_embedder(&self, package: &str) -> Result<(), PolicyError> {
        let kind = embedder_kind(package);
        let allowed = match kind {
            EmbedderKind::Local => self.allow_local,
            EmbedderKind::Hosted => self.allow_hosted,
        };
        if allowed {
            Ok(())
        } else {
            Err(PolicyError::EmbedderNotAllowed(kind.as_str()))
        }
    }

    /// Add the policy's ignore globs on top of the config's global `ignore`, which every fileSet
    /// inherits.
    pub fn apply_to_config(&self, cfg: &mut VirageConfigJson) {
        for g in &self.ignore_globs {
            if !cfg.ignore.contains(g) {
                cfg.ignore.push(g.clone());
            }
        }
    }

    pub fn matcher(&self) -> PolicyMatcher {
        let mut b = GlobSetBuilder::new();
        for g in &self.ignore_globs {
            if let Ok(glob) = Glob::new(g) {
                b.add(glob);
            }
        }
        PolicyMatcher {
            set: b.build().unwrap_or_else(|_| GlobSet::empty()),
        }
    }
}

/// Matches project-relative paths against a policy's `ignore` globs.
pub struct PolicyMatcher {
    set: GlobSet,
}

impl PolicyMatcher {
    pub fn is_ignored(&self, path: &str) -> bool {
        let p = path.replace('\\', "/");
        let p = p.strip_prefix("./").unwrap_or(&p);
        self.set.is_match(p)
    }
}

/// Convert one gitignore-syntax line to globset patterns matching the same paths.
///
/// Blank lines, comments and negations (`!x`) yield nothing: a negation never un-ignores.
/// A pattern without a `/` (apart from a trailing one) matches at any depth; a leading `/`
/// anchors to the project root. A match on a directory also covers everything under it.
pub fn gitignore_to_globs(line: &str) -> Vec<String> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') || line.starts_with('!') {
        return Vec::new();
    }
    let dir_only = line.ends_with('/');
    let body = line.trim_end_matches('/');
    let (anchored, body) = match body.strip_prefix('/') {
        Some(rest) => (true, rest),
        None => (body.contains('/'), body),
    };
    if body.is_empty() {
        return Vec::new();
    }
    let base = if anchored || body.starts_with("**/") {
        body.to_string()
    } else {
        format!("**/{body}")
    };
    if dir_only {
        vec![format!("{base}/**")]
    } else {
        vec![base.clone(), format!("{base}/**")]
    }
}

/// Load the policy for a project.
///
/// - file present: parse it (always enforced, whatever the mode);
/// - file absent and `conformance`: `Err(Missing)` (fail closed);
/// - file absent otherwise: `Ok(None)`.
pub fn load(project_dir: &Path, conformance: bool) -> Result<Option<Policy>, PolicyError> {
    let path = policy_path(project_dir);
    let shown = POLICY_PATH.to_string();
    match std::fs::read_to_string(&path) {
        Ok(raw) => Policy::parse(&raw, &shown).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if conformance {
                Err(PolicyError::Missing(shown))
            } else {
                Ok(None)
            }
        }
        Err(_) => Err(PolicyError::Unreadable(shown)),
    }
}

/// Gate for an index run: load the policy, refuse a disallowed embedder, and add the ignore globs
/// to `cfg`. Call before the embedder is resolved and again before each re-index in a long run.
pub fn enforce_for_index(
    project_dir: &Path,
    config_path: &Path,
    cfg: &mut VirageConfigJson,
) -> Result<(), PolicyError> {
    let conformance = super::is_conformance_mode(project_dir, config_path);
    if let Some(policy) = load(project_dir, conformance)? {
        policy.check_embedder(&cfg.providers.embedder.package)?;
        policy.apply_to_config(cfg);
    }
    Ok(())
}

/// Gate for a query: load the policy, refuse a disallowed embedder, and return a matcher for
/// filtering results. `Ok(None)` means no policy applies.
pub fn enforce_for_query(
    project_dir: &Path,
    config_path: &Path,
    cfg: &VirageConfigJson,
) -> Result<Option<PolicyMatcher>, PolicyError> {
    let conformance = super::is_conformance_mode(project_dir, config_path);
    match load(project_dir, conformance)? {
        None => Ok(None),
        Some(policy) => {
            policy.check_embedder(&cfg.providers.embedder.package)?;
            Ok(Some(policy.matcher()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: &str = ".go-getter/retrieval/policy.json";

    fn good(extra_ignore: &str, embedders: &str) -> String {
        format!(
            r#"{{"contractVersion":0,"ignore":[{extra_ignore}],"embedders":[{embedders}],"dataClass":"internal"}}"#
        )
    }

    #[test]
    fn parses_a_valid_policy() {
        let p = Policy::parse(&good(r#""**/.env","secrets/**""#, r#""local""#), P).unwrap();
        assert!(p.allow_local && !p.allow_hosted);
        assert_eq!(p.data_class, "internal");
        assert!(p.ignore_globs.contains(&"**/.env".to_string()));
        assert!(p.ignore_globs.contains(&"secrets/**".to_string()));
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let raw = r#"{"contractVersion":0,"ignore":[],"embedders":["local"],"dataClass":"public","future":1}"#;
        assert!(Policy::parse(raw, P).is_ok());
    }

    #[test]
    fn each_missing_field_is_refused() {
        for (raw, field) in [
            (
                r#"{"ignore":[],"embedders":["local"],"dataClass":"public"}"#,
                "contractVersion",
            ),
            (
                r#"{"contractVersion":0,"embedders":["local"],"dataClass":"public"}"#,
                "ignore",
            ),
            (
                r#"{"contractVersion":0,"ignore":[],"dataClass":"public"}"#,
                "embedders",
            ),
            (
                r#"{"contractVersion":0,"ignore":[],"embedders":["local"]}"#,
                "dataClass",
            ),
        ] {
            assert_eq!(
                Policy::parse(raw, P).unwrap_err(),
                PolicyError::Invalid {
                    path: P.to_string(),
                    field
                },
            );
        }
    }

    #[test]
    fn malformed_fields_are_refused() {
        assert!(Policy::parse(
            r#"{"contractVersion":0,"ignore":[1],"embedders":[],"dataClass":"public"}"#,
            P
        )
        .is_err());
        assert!(Policy::parse(
            r#"{"contractVersion":0,"ignore":[],"embedders":[],"dataClass":"secret-ish"}"#,
            P
        )
        .is_err());
        assert!(Policy::parse("not json", P).is_err());
    }

    #[test]
    fn unknown_contract_version_is_refused() {
        let raw = r#"{"contractVersion":1,"ignore":[],"embedders":["local"],"dataClass":"public"}"#;
        assert_eq!(
            Policy::parse(raw, P).unwrap_err(),
            PolicyError::UnsupportedVersion(P.to_string())
        );
        let raw =
            r#"{"contractVersion":"0","ignore":[],"embedders":["local"],"dataClass":"public"}"#;
        assert!(Policy::parse(raw, P).is_err());
    }

    #[test]
    fn hosted_embedder_refused_unless_listed() {
        let local_only = Policy::parse(&good("", r#""local""#), P).unwrap();
        assert!(local_only
            .check_embedder("@vivantel/virage-embedder-onnx")
            .is_ok());
        assert_eq!(
            local_only
                .check_embedder("@vivantel/virage-embedder-openai")
                .unwrap_err(),
            PolicyError::EmbedderNotAllowed("hosted")
        );
        let both = Policy::parse(&good("", r#""local","hosted""#), P).unwrap();
        assert!(both
            .check_embedder("@vivantel/virage-embedder-openai")
            .is_ok());
        let hosted_only = Policy::parse(&good("", r#""hosted""#), P).unwrap();
        assert_eq!(
            hosted_only
                .check_embedder("@vivantel/virage-embedder-fastembed")
                .unwrap_err(),
            PolicyError::EmbedderNotAllowed("local")
        );
    }

    #[test]
    fn unknown_embedder_package_counts_as_hosted() {
        assert_eq!(embedder_kind("some-vendor-embedder"), EmbedderKind::Hosted);
        assert_eq!(
            embedder_kind("@vivantel/virage-embedder-onnx"),
            EmbedderKind::Local
        );
    }

    #[test]
    fn errors_name_a_path_or_kind_only() {
        let e = Policy::parse(r#"{"contractVersion":0,"ignore":[7],"embedders":[]}"#, P)
            .unwrap_err()
            .to_string();
        assert!(e.contains(P));
        let e = PolicyError::EmbedderNotAllowed("hosted").to_string();
        assert!(e.contains("hosted"));
    }

    #[test]
    fn gitignore_conversion() {
        assert_eq!(gitignore_to_globs(".env"), vec!["**/.env", "**/.env/**"]);
        assert_eq!(gitignore_to_globs("**/.env"), vec!["**/.env", "**/.env/**"]);
        assert_eq!(gitignore_to_globs("secrets/"), vec!["**/secrets/**"]);
        assert_eq!(
            gitignore_to_globs("secrets/**"),
            vec!["secrets/**", "secrets/**/**"]
        );
        assert_eq!(gitignore_to_globs("/build"), vec!["build", "build/**"]);
        assert!(gitignore_to_globs("# comment").is_empty());
        assert!(gitignore_to_globs("!keep.txt").is_empty());
        assert!(gitignore_to_globs("   ").is_empty());
    }

    #[test]
    fn matcher_covers_files_dirs_and_depth() {
        let p = Policy::parse(&good(r#""**/.env","secrets/**","*.pem""#, r#""local""#), P).unwrap();
        let m = p.matcher();
        assert!(m.is_ignored(".env"));
        assert!(m.is_ignored("a/b/.env"));
        assert!(m.is_ignored("secrets/key.txt"));
        assert!(m.is_ignored("./secrets/deep/key.txt"));
        assert!(m.is_ignored("certs/server.pem"));
        assert!(m.is_ignored("secrets\\key.txt"));
        assert!(!m.is_ignored("src/main.rs"));
        assert!(!m.is_ignored("docs/secrets-guide.md"));
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "virage-policy-{name}-{}-{}",
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
    fn load_fails_closed_when_missing_in_conformance_mode() {
        let dir = tmp("missing");
        assert!(matches!(load(&dir, true), Err(PolicyError::Missing(_))));
        assert!(load(&dir, false).unwrap().is_none());
    }

    #[test]
    fn load_enforces_a_present_file_in_any_mode() {
        let dir = tmp("present");
        std::fs::create_dir_all(dir.join(".go-getter/retrieval")).unwrap();
        std::fs::write(policy_path(&dir), good(r#""x""#, r#""local""#)).unwrap();
        assert!(load(&dir, false).unwrap().is_some());
        std::fs::write(policy_path(&dir), "{}").unwrap();
        assert!(load(&dir, false).is_err());
    }
}
