use std::collections::HashMap;

use async_trait::async_trait;
use bytes::Bytes;
use futures::stream::BoxStream;
use serde_json::Value;

/// A single addressable item produced by a `SourceProvider`.
pub struct SourceItem {
    pub id: String,
    pub path: String,
    pub provider_name: String,
    pub labels: Vec<String>,
    pub meta: HashMap<String, Value>,
}

/// Filter applied when listing items from a source.
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
    async fn current_revision(&self) -> anyhow::Result<String>;
    /// Per-file stable content identifiers (git blob SHA or content hash).
    async fn file_revisions(&self, paths: &[&str]) -> anyhow::Result<HashMap<String, String>>;
    /// Files changed between `rev` and now. Returns `None` when `rev` is unknown.
    async fn changed_since(&self, rev: &str) -> anyhow::Result<Option<ChangedFiles>>;
    /// Streaming enumeration of all items matching optional filter.
    fn list_all(&self, filter: Option<SourceFilter>) -> BoxStream<'_, anyhow::Result<SourceItem>>;
    /// Read raw bytes of a file, optionally clamped to `range`.
    async fn read_content(&self, path: &str, range: Option<ByteRange>) -> anyhow::Result<Bytes>;
}

// ─── Shared glob helpers ──────────────────────────────────────────────────────

/// Match `path` against a glob `pattern` (no dot-special treatment).
pub(crate) fn glob_match(pattern: &str, path: &str) -> bool {
    globset::Glob::new(pattern)
        .ok()
        .map(|g| g.compile_matcher().is_match(path))
        .unwrap_or(false)
}

/// Match `path` against `pattern` or `pattern/**` (replicates TS minimatch directory rule).
pub(crate) fn glob_match_dir(pattern: &str, path: &str) -> bool {
    glob_match(pattern, path) || glob_match(&format!("{pattern}/**"), path)
}

/// Slice `data` according to optional `ByteRange`.
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
