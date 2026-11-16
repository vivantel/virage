use std::collections::HashMap;
use std::sync::{Arc, OnceLock, PoisonError, RwLock};

use async_trait::async_trait;
use bytes::Bytes;
use futures::stream::BoxStream;
use serde_json::Value;

/// A single addressable item produced by a `SourceProvider`.
pub struct SourceItem {
    pub id: String,
    pub path: String,
    pub provider_name: String,
    pub tags: Vec<String>,
    pub meta: HashMap<String, Value>,
}

/// Filter applied when listing items from a source.
#[derive(Clone)]
pub struct SourceFilter {
    /// Only return items whose path matches at least one of these globs.
    pub include: Option<Vec<String>>,
    /// Exclude items whose path matches any of these globs.
    pub ignore: Vec<String>,
}

/// Files changed between two revisions.
pub struct ChangedFiles {
    pub added: Vec<String>,
    pub modified: Vec<String>,
    pub deleted: Vec<String>,
}

/// Half-open byte range `[start, end)` for partial content reads.
pub struct ByteRange {
    pub start: u64,
    pub end: u64,
}

/// CE extension point for file/blob enumeration and content access (ADR-049).
///
/// Implementations: `GitSourceProvider` (CE), `LocalFsSourceProvider` (CE).
/// EE providers (S3, GCS, Azure Blob, JDBC) live in `virage-engine-ee` (Phase 8).
#[async_trait]
pub trait SourceProvider: Send + Sync {
    fn name(&self) -> &str;
    fn provider_type(&self) -> &str;
    /// Stable revision token for the current state (git HEAD SHA, manifest hash, etc.).
    #[must_use = "revision token must be used to track source state"]
    async fn current_revision(&self) -> anyhow::Result<String>;
    /// Per-file stable content identifiers (git blob SHA or content hash).
    #[must_use = "file revisions must be used for change detection"]
    async fn file_revisions(&self, paths: &[&str]) -> anyhow::Result<HashMap<String, String>>;
    /// Files changed between `rev` and now. Returns `None` when `rev` is unknown.
    #[must_use = "changed files must be used to determine indexing scope"]
    async fn changed_since(&self, rev: &str) -> anyhow::Result<Option<ChangedFiles>>;
    /// Streaming enumeration of all items matching optional filter.
    #[must_use = "source items must be consumed to enumerate source files"]
    fn list_all(&self, filter: Option<SourceFilter>) -> BoxStream<'_, anyhow::Result<SourceItem>>;
    /// Read raw bytes of a file, optionally clamped to `range`.
    #[must_use = "file content must be used for chunking and indexing"]
    async fn read_content(&self, path: &str, range: Option<ByteRange>) -> anyhow::Result<Bytes>;
}

// ─── Shared glob helpers ──────────────────────────────────────────────────────

/// Compiled matcher for `pattern`, built once per distinct pattern string (an invalid pattern is
/// remembered as `None`). Building a matcher compiles a regex, which costs far more than
/// matching a path, and a walk matches every file against every fileSet and CODEOWNERS pattern.
/// The cache is bounded by the number of distinct patterns, which come from configuration.
fn cached_matcher(pattern: &str) -> Option<Arc<globset::GlobMatcher>> {
    type Matchers = RwLock<HashMap<String, Option<Arc<globset::GlobMatcher>>>>;
    static CACHE: OnceLock<Matchers> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(hit) = cache
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .get(pattern)
    {
        return hit.clone();
    }
    let compiled = globset::Glob::new(pattern)
        .ok()
        .map(|g| Arc::new(g.compile_matcher()));
    cache
        .write()
        .unwrap_or_else(PoisonError::into_inner)
        .entry(pattern.to_string())
        .or_insert(compiled)
        .clone()
}

/// Match `path` against a glob `pattern` (no dot-special treatment).
#[allow(dead_code)]
pub(crate) fn glob_match(pattern: &str, path: &str) -> bool {
    cached_matcher(pattern).is_some_and(|m| m.is_match(path))
}

/// Match `path` against `pattern` or `pattern/**` (replicates TS minimatch directory rule).
#[allow(dead_code)]
pub(crate) fn glob_match_dir(pattern: &str, path: &str) -> bool {
    glob_match(pattern, path) || glob_match(&format!("{pattern}/**"), path)
}

/// Slice `data` according to optional `ByteRange`.
#[allow(dead_code)]
pub(crate) fn apply_range(data: Vec<u8>, range: Option<ByteRange>) -> Bytes {
    match range {
        None => Bytes::from(data),
        Some(r) => {
            let start = r.start as usize;
            let end = (r.end as usize).min(data.len());
            if start >= data.len() {
                Bytes::new()
            } else {
                Bytes::copy_from_slice(&data[start..end])
            }
        }
    }
}

#[cfg(feature = "source-git")]
pub mod git;
#[cfg(feature = "source-localfs")]
pub mod local_fs;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_match_is_stable_across_repeated_calls() {
        let cases = [
            ("**/*.md", "docs/guide/intro.md", true),
            ("**/*.md", "docs/guide/intro.txt", false),
            ("packages/*/src/**/*.ts", "packages/a/src/x/y.ts", true),
            ("packages/*/src/**/*.ts", "packages/a/lib/y.ts", false),
            ("scripts/check-*.mjs", "scripts/check-ids.mjs", true),
        ];
        for _ in 0..3 {
            for (pattern, path, expected) in cases {
                assert_eq!(glob_match(pattern, path), expected, "{pattern} vs {path}");
            }
        }
    }

    #[test]
    fn invalid_pattern_never_matches_and_stays_that_way() {
        for _ in 0..3 {
            assert!(!glob_match("[", "["));
            assert!(!glob_match("[", "a"));
        }
    }

    #[test]
    fn glob_match_dir_matches_the_directory_and_its_contents() {
        assert!(glob_match_dir("docs", "docs"));
        assert!(glob_match_dir("docs", "docs/a/b.md"));
        assert!(!glob_match_dir("docs", "other/docs.md"));
    }
}
