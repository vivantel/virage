use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use bytes::Bytes;
use futures::stream::{self, BoxStream, StreamExt};
use serde_json::json;

use super::{
    apply_range, glob_match, glob_match_dir, ByteRange, ChangedFiles, SourceFilter, SourceItem,
    SourceProvider,
};

// ─── GitSourceProvider ────────────────────────────────────────────────────────

pub struct GitSourceProvider {
    root: PathBuf,
    provider_name: String,
    exclude_patterns: Vec<String>,
    codeowners: Option<Codeowners>,
    branch: Option<String>,
}

impl GitSourceProvider {
    /// Open the git repo at `root` (fails if not a git repo).
    pub fn open(root: impl AsRef<Path>, name: impl Into<String>) -> anyhow::Result<Self> {
        Self::open_branch(root, name, None)
    }

    /// Open with optional branch selection. `branch: None` uses current HEAD.
    pub fn open_branch(
        root: impl AsRef<Path>,
        name: impl Into<String>,
        branch: Option<String>,
    ) -> anyhow::Result<Self> {
        Self::with_excludes_branch(root, name, vec![], branch)
    }

    pub fn with_excludes(
        root: impl AsRef<Path>,
        name: impl Into<String>,
        exclude_patterns: Vec<String>,
    ) -> anyhow::Result<Self> {
        Self::with_excludes_branch(root, name, exclude_patterns, None)
    }

    pub fn with_excludes_branch(
        root: impl AsRef<Path>,
        name: impl Into<String>,
        exclude_patterns: Vec<String>,
        branch: Option<String>,
    ) -> anyhow::Result<Self> {
        let root = root.as_ref().to_path_buf();
        let repo = git2::Repository::open(&root)?;
        if let Some(b) = &branch {
            repo.find_branch(b, git2::BranchType::Local)
                .map_err(|_| anyhow::anyhow!("git branch {b:?} not found in repo at {root:?}"))?;
        }
        let codeowners = Codeowners::from_dir(&root);
        Ok(Self {
            root,
            provider_name: name.into(),
            exclude_patterns,
            codeowners,
            branch,
        })
    }

    fn open_repo(&self) -> anyhow::Result<git2::Repository> {
        Ok(git2::Repository::open(&self.root)?)
    }

    fn is_excluded(&self, path: &str) -> bool {
        self.exclude_patterns.iter().any(|p| glob_match(p, path))
    }

    fn tip_commit<'r>(&self, repo: &'r git2::Repository) -> anyhow::Result<git2::Commit<'r>> {
        match &self.branch {
            Some(b) => {
                let branch = repo
                    .find_branch(b, git2::BranchType::Local)
                    .map_err(|_| anyhow::anyhow!("git branch {b:?} not found"))?;
                Ok(branch.get().peel_to_commit()?)
            }
            None => Ok(repo.head()?.peel_to_commit()?),
        }
    }

    /// Build a map of relative path → blob SHA for the tip tree.
    fn head_tree_map(&self, repo: &git2::Repository) -> anyhow::Result<HashMap<String, String>> {
        let commit = self.tip_commit(repo)?;
        let tree = commit.tree()?;
        let mut map = HashMap::new();
        tree.walk(git2::TreeWalkMode::PreOrder, |parent, entry| {
            if entry.kind() == Some(git2::ObjectType::Blob) {
                let path = format!("{}{}", parent, entry.name().unwrap_or(""));
                map.insert(path, entry.id().to_string());
            }
            git2::TreeWalkResult::Ok
        })?;
        Ok(map)
    }
}

#[async_trait]
impl SourceProvider for GitSourceProvider {
    fn name(&self) -> &str {
        &self.provider_name
    }

    fn provider_type(&self) -> &str {
        "git"
    }

    async fn current_revision(&self) -> anyhow::Result<String> {
        let repo = self.open_repo()?;
        let commit = self.tip_commit(&repo)?;
        Ok(commit.id().to_string())
    }

    async fn file_revisions(&self, paths: &[&str]) -> anyhow::Result<HashMap<String, String>> {
        if paths.is_empty() {
            return Ok(HashMap::new());
        }
        let repo = self.open_repo()?;
        let tree_map = self.head_tree_map(&repo)?;
        let dirty_set: HashSet<String> = {
            let statuses = repo.statuses(None)?;
            statuses
                .iter()
                .filter_map(|s| s.path().ok().map(|p| p.replace('\\', "/")))
                .collect()
        };

        let mut result = HashMap::new();
        for &path in paths {
            let normalized = path.replace('\\', "/");
            let committed_sha = tree_map.get(&normalized);
            let is_dirty = dirty_set.contains(&normalized);

            if is_dirty || committed_sha.is_none() {
                // Hash current on-disk content as a git blob (same as `git hash-object <file>`)
                let full_path = self.root.join(path);
                if let Ok(data) = std::fs::read(&full_path) {
                    let oid = repo.blob(&data)?;
                    result.insert(path.to_string(), oid.to_string());
                } else if let Some(sha) = committed_sha {
                    // Fallback: can't read file, use last committed sha
                    result.insert(path.to_string(), sha.clone());
                }
            } else if let Some(sha) = committed_sha {
                result.insert(path.to_string(), sha.clone());
            }
        }
        Ok(result)
    }

    async fn changed_since(&self, rev: &str) -> anyhow::Result<Option<ChangedFiles>> {
        let repo = self.open_repo()?;
        let old_oid = match repo.revparse_single(rev) {
            Ok(obj) => obj.id(),
            Err(_) => return Ok(None),
        };
        let old_commit = repo.find_commit(old_oid)?;
        let old_tree = old_commit.tree()?;
        let new_commit = self.tip_commit(&repo)?;
        let new_tree = new_commit.tree()?;
        let diff = repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), None)?;

        // Collect (status, path) pairs first to avoid borrow conflicts in the closure.
        let mut deltas: Vec<(git2::Delta, String)> = Vec::new();
        diff.foreach(
            &mut |delta, _progress| {
                let path = delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .and_then(|p| p.to_str())
                    .map(|s| s.replace('\\', "/"))
                    .unwrap_or_default();
                deltas.push((delta.status(), path));
                true
            },
            None,
            None,
            None,
        )?;

        let mut added = vec![];
        let mut modified = vec![];
        let mut deleted = vec![];
        for (status, path) in deltas {
            if self.is_excluded(&path) {
                continue;
            }
            match status {
                git2::Delta::Added => added.push(path),
                git2::Delta::Modified => modified.push(path),
                git2::Delta::Deleted => deleted.push(path),
                _ => {}
            }
        }
        Ok(Some(ChangedFiles {
            added,
            modified,
            deleted,
        }))
    }

    fn list_all(&self, filter: Option<SourceFilter>) -> BoxStream<'_, anyhow::Result<SourceItem>> {
        let result: anyhow::Result<Vec<SourceItem>> = (|| {
            let repo = self.open_repo()?;
            let tree_map = self.head_tree_map(&repo)?;
            let mut items: Vec<SourceItem> = tree_map
                .into_iter()
                .filter(|(path, _)| {
                    if self.is_excluded(path) {
                        return false;
                    }
                    if let Some(f) = &filter {
                        if f.ignore.iter().any(|p| glob_match_dir(p, path)) {
                            return false;
                        }
                        if let Some(inc) = &f.include {
                            if !inc.iter().any(|p| glob_match_dir(p, path)) {
                                return false;
                            }
                        }
                    }
                    true
                })
                .map(|(path, blob_sha)| {
                    let labels = self
                        .codeowners
                        .as_ref()
                        .map(|co| co.labels_for_file(&path))
                        .unwrap_or_default();
                    let mut meta = HashMap::new();
                    meta.insert("blobSha".to_string(), json!(blob_sha.clone()));
                    SourceItem {
                        id: blob_sha,
                        path,
                        provider_name: self.provider_name.clone(),
                        labels,
                        meta,
                    }
                })
                .collect();
            items.sort_by(|a, b| a.path.cmp(&b.path));
            Ok(items)
        })();
        match result {
            Ok(items) => stream::iter(items.into_iter().map(Ok)).boxed(),
            Err(e) => stream::once(async move { Err(e) }).boxed(),
        }
    }

    async fn read_content(&self, path: &str, range: Option<ByteRange>) -> anyhow::Result<Bytes> {
        let full_path = self.root.join(path);
        let data = tokio::fs::read(full_path).await?;
        Ok(apply_range(data, range))
    }
}

// ─── CODEOWNERS ───────────────────────────────────────────────────────────────
// Replicates TS CodeownersResolver: last-matching-rule-wins, owner → label conversion.

struct CodeownersEntry {
    raw_pattern: String,
    match_base: bool,
    owners: Vec<String>,
}

struct Codeowners {
    entries: Vec<CodeownersEntry>,
}

impl Codeowners {
    fn from_dir(root: &Path) -> Option<Self> {
        for candidate in [
            root.join(".github").join("CODEOWNERS"),
            root.join("CODEOWNERS"),
            root.join("docs").join("CODEOWNERS"),
        ] {
            if let Ok(content) = std::fs::read_to_string(&candidate) {
                return Some(Self::from_content(&content));
            }
        }
        None
    }

    fn from_content(content: &str) -> Self {
        let entries = content
            .lines()
            .filter_map(|line| {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    return None;
                }
                let mut parts = line.split_whitespace();
                let pattern = parts.next()?;
                let owners: Vec<String> = parts.map(String::from).collect();
                if owners.is_empty() {
                    return None;
                }
                // Patterns without a '/' match at any directory depth (matchBase).
                let match_base = !pattern.contains('/');
                let raw_pattern = pattern.trim_start_matches('/').to_string();
                Some(CodeownersEntry {
                    raw_pattern,
                    match_base,
                    owners,
                })
            })
            .collect();
        Codeowners { entries }
    }

    fn labels_for_file(&self, path: &str) -> Vec<String> {
        let normalized = path.trim_start_matches('/');
        let mut last_match: Option<&[String]> = None;
        for entry in &self.entries {
            let matched = if entry.match_base {
                let filename = Path::new(normalized)
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or(normalized);
                // matchBase: check against just the filename OR the full path
                glob_match(&entry.raw_pattern, filename)
                    || glob_match(&entry.raw_pattern, normalized)
            } else {
                // Exact path match or directory-prefix match
                glob_match(&entry.raw_pattern, normalized)
                    || glob_match(&format!("{}/**", entry.raw_pattern), normalized)
            };
            if matched {
                last_match = Some(&entry.owners);
            }
        }
        last_match
            .map(|owners| owners.iter().map(|o| owner_to_label(o)).collect())
            .unwrap_or_default()
    }
}

fn owner_to_label(owner: &str) -> String {
    let stripped = owner.trim_start_matches('@');
    match stripped.find('/') {
        Some(idx) => format!("team:{}", &stripped[idx + 1..]),
        None => format!("owner:{stripped}"),
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;

    fn virage_root() -> PathBuf {
        // CARGO_MANIFEST_DIR = crates/virage-engine
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap() // crates/
            .parent()
            .unwrap() // virage/
            .to_path_buf()
    }

    // ── GitSourceProvider ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn current_revision_returns_40_char_sha() {
        let p = GitSourceProvider::open(virage_root(), "git").unwrap();
        let rev = p.current_revision().await.unwrap();
        assert_eq!(rev.len(), 40, "expected 40-char SHA, got: {rev}");
        assert!(rev.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn file_revisions_blob_sha_for_known_file() {
        let p = GitSourceProvider::open(virage_root(), "git").unwrap();
        let revs = p.file_revisions(&["Cargo.toml"]).await.unwrap();
        let sha = revs
            .get("Cargo.toml")
            .expect("Cargo.toml should be tracked");
        assert_eq!(sha.len(), 40, "blob SHA should be 40 hex chars");
        assert!(sha.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn file_revisions_empty_input_returns_empty_map() {
        let p = GitSourceProvider::open(virage_root(), "git").unwrap();
        let revs = p.file_revisions(&[]).await.unwrap();
        assert!(revs.is_empty());
    }

    #[tokio::test]
    async fn changed_since_unknown_rev_returns_none() {
        let p = GitSourceProvider::open(virage_root(), "git").unwrap();
        let result = p
            .changed_since("0000000000000000000000000000000000000000")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn changed_since_self_returns_empty_diff() {
        let p = GitSourceProvider::open(virage_root(), "git").unwrap();
        let rev = p.current_revision().await.unwrap();
        let result = p.changed_since(&rev).await.unwrap();
        let changes = result.expect("HEAD..HEAD should return Some with empty diff");
        assert!(changes.added.is_empty());
        assert!(changes.modified.is_empty());
        assert!(changes.deleted.is_empty());
    }

    #[tokio::test]
    async fn list_all_yields_root_cargo_toml() {
        let p = GitSourceProvider::open(virage_root(), "git").unwrap();
        let items: Vec<_> = p.list_all(None).collect().await;
        let found = items
            .iter()
            .any(|r| r.as_ref().map(|i| i.path == "Cargo.toml").unwrap_or(false));
        assert!(found, "list_all should include root Cargo.toml");
    }

    #[tokio::test]
    async fn list_all_ignore_filter_excludes_toml() {
        let p = GitSourceProvider::open(virage_root(), "git").unwrap();
        let filter = SourceFilter {
            include: None,
            ignore: vec!["**/*.toml".to_string()],
        };
        let items: Vec<_> = p.list_all(Some(filter)).collect().await;
        let any_toml = items.iter().any(|r| {
            r.as_ref()
                .map(|i| i.path.ends_with(".toml"))
                .unwrap_or(false)
        });
        assert!(!any_toml, "ignore **/*.toml should exclude all .toml files");
    }

    #[tokio::test]
    async fn list_all_include_filter_restricts_to_rust_files() {
        let p = GitSourceProvider::open(virage_root(), "git").unwrap();
        let filter = SourceFilter {
            include: Some(vec!["**/*.rs".to_string()]),
            ignore: vec![],
        };
        let items: Vec<_> = p.list_all(Some(filter)).collect().await;
        assert!(!items.is_empty(), "should find Rust source files");
        let all_rs = items
            .iter()
            .all(|r| r.as_ref().map(|i| i.path.ends_with(".rs")).unwrap_or(true));
        assert!(all_rs, "all items should be .rs files");
    }

    #[tokio::test]
    async fn read_content_returns_file_bytes() {
        let p = GitSourceProvider::open(virage_root(), "git").unwrap();
        let content = p.read_content("Cargo.toml", None).await.unwrap();
        assert!(!content.is_empty());
        let text = std::str::from_utf8(&content).unwrap();
        assert!(text.contains("[workspace]"));
    }

    #[tokio::test]
    async fn read_content_byte_range() {
        let p = GitSourceProvider::open(virage_root(), "git").unwrap();
        let full = p.read_content("Cargo.toml", None).await.unwrap();
        let partial = p
            .read_content("Cargo.toml", Some(ByteRange { start: 0, end: 5 }))
            .await
            .unwrap();
        assert_eq!(partial.len(), 5);
        assert_eq!(&partial[..], &full[..5]);
    }

    // ── CODEOWNERS ────────────────────────────────────────────────────────────

    #[test]
    fn codeowners_org_team_owner() {
        let co = Codeowners::from_content("*.rs @org/rust-team\n");
        let labels = co.labels_for_file("src/lib.rs");
        assert!(
            labels.contains(&"team:rust-team".to_string()),
            "got: {labels:?}"
        );
    }

    #[test]
    fn codeowners_username_owner() {
        let co = Codeowners::from_content("* @alice\n");
        let labels = co.labels_for_file("any/file.txt");
        assert_eq!(labels, vec!["owner:alice".to_string()]);
    }

    #[test]
    fn codeowners_last_rule_wins() {
        let co = Codeowners::from_content("* @org/everyone\n/src/** @org/core\n");
        let labels = co.labels_for_file("src/lib.rs");
        assert_eq!(labels, vec!["team:core".to_string()]);
    }

    #[test]
    fn codeowners_no_match_returns_empty() {
        let co = Codeowners::from_content("/docs/** @org/docs-team\n");
        let labels = co.labels_for_file("src/lib.rs");
        assert!(labels.is_empty());
    }

    #[test]
    fn codeowners_comment_lines_ignored() {
        let co = Codeowners::from_content("# this is a comment\n*.rs @org/team\n");
        let labels = co.labels_for_file("lib.rs");
        assert!(!labels.is_empty());
    }

    #[test]
    fn owner_to_label_converts_correctly() {
        assert_eq!(owner_to_label("@org/team-name"), "team:team-name");
        assert_eq!(owner_to_label("@username"), "owner:username");
        assert_eq!(owner_to_label("username"), "owner:username");
    }

    // ── apply_range (via mod) ─────────────────────────────────────────────────

    #[test]
    fn apply_range_no_range_returns_all() {
        let data = b"hello world".to_vec();
        let result = apply_range(data, None);
        assert_eq!(&result[..], b"hello world");
    }

    #[test]
    fn apply_range_partial_slice() {
        let data = b"hello world".to_vec();
        let result = apply_range(data, Some(ByteRange { start: 0, end: 5 }));
        assert_eq!(&result[..], b"hello");
    }

    #[test]
    fn apply_range_clamps_past_end() {
        let data = b"hi".to_vec();
        let result = apply_range(data, Some(ByteRange { start: 0, end: 100 }));
        assert_eq!(&result[..], b"hi");
    }
}
