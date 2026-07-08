use std::collections::HashMap;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use bytes::Bytes;
use futures::stream::{self, BoxStream, StreamExt};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use super::{
    apply_range, glob_match, glob_match_dir, ByteRange, ChangedFiles, SourceFilter, SourceItem,
    SourceProvider,
};

// ─── LocalFsSourceProvider ────────────────────────────────────────────────────

pub struct LocalFsSourceProvider {
    root: PathBuf,
    provider_name: String,
    exclude_patterns: Vec<String>,
}

impl LocalFsSourceProvider {
    pub fn new(root: impl AsRef<Path>, name: impl Into<String>) -> Self {
        Self::with_excludes(root, name, vec![])
    }

    pub fn with_excludes(
        root: impl AsRef<Path>,
        name: impl Into<String>,
        exclude_patterns: Vec<String>,
    ) -> Self {
        Self {
            root: root.as_ref().to_path_buf(),
            provider_name: name.into(),
            exclude_patterns,
        }
    }

    fn is_excluded(&self, path: &str) -> bool {
        self.exclude_patterns.iter().any(|p| glob_match(p, path))
    }

    fn relative_path(&self, full: &Path) -> Option<String> {
        full.strip_prefix(&self.root)
            .ok()
            .and_then(|p| p.to_str())
            .map(|s| s.replace('\\', "/"))
    }

    fn walk_files(&self) -> Vec<(PathBuf, String)> {
        WalkDir::new(&self.root)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| {
                let rel = self.relative_path(e.path())?;
                if self.is_excluded(&rel) {
                    return None;
                }
                Some((e.into_path(), rel))
            })
            .collect()
    }
}

#[async_trait]
impl SourceProvider for LocalFsSourceProvider {
    fn name(&self) -> &str {
        &self.provider_name
    }

    fn provider_type(&self) -> &str {
        "localfs"
    }

    /// Manifest hash: SHA-256 over sorted (path, mtime_ms) pairs.
    async fn current_revision(&self) -> anyhow::Result<String> {
        let mut entries: Vec<(String, i64)> = self
            .walk_files()
            .into_iter()
            .filter_map(|(full, rel)| {
                let mtime = std::fs::metadata(&full).ok()?.modified().ok()?;
                let ms = mtime
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()?
                    .as_millis() as i64;
                Some((rel, ms))
            })
            .collect();
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let mut hasher = Sha256::new();
        for (path, mtime) in &entries {
            hasher.update(path.as_bytes());
            hasher.update(b"\0");
            hasher.update(mtime.to_le_bytes());
        }
        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Per-file SHA-256 content hash.
    async fn file_revisions(&self, paths: &[&str]) -> anyhow::Result<HashMap<String, String>> {
        let mut result = HashMap::new();
        for &path in paths {
            let full = self.root.join(path);
            if let Ok(data) = std::fs::read(&full) {
                let mut hasher = Sha256::new();
                hasher.update(&data);
                result.insert(path.to_string(), format!("{:x}", hasher.finalize()));
            }
        }
        Ok(result)
    }

    /// LocalFs has no revision history — always returns `None`.
    async fn changed_since(&self, _rev: &str) -> anyhow::Result<Option<ChangedFiles>> {
        Ok(None)
    }

    fn list_all(&self, filter: Option<SourceFilter>) -> BoxStream<'_, anyhow::Result<SourceItem>> {
        let mut items: Vec<SourceItem> = self
            .walk_files()
            .into_iter()
            .filter_map(|(full, rel)| {
                if let Some(f) = &filter {
                    if f.ignore.iter().any(|p| glob_match_dir(p, &rel)) {
                        return None;
                    }
                    if let Some(inc) = &f.include {
                        if !inc.iter().any(|p| glob_match_dir(p, &rel)) {
                            return None;
                        }
                    }
                }
                let size = std::fs::metadata(&full).ok().map(|m| m.len()).unwrap_or(0);
                let data = std::fs::read(&full).ok()?;
                let mut hasher = Sha256::new();
                hasher.update(&data);
                let sha = format!("{:x}", hasher.finalize());
                let mut meta = HashMap::new();
                meta.insert("size".to_string(), serde_json::json!(size));
                Some(SourceItem {
                    id: sha,
                    path: rel,
                    provider_name: self.provider_name.clone(),
                    labels: vec![],
                    meta,
                })
            })
            .collect();
        items.sort_by(|a, b| a.path.cmp(&b.path));
        stream::iter(items.into_iter().map(Ok)).boxed()
    }

    async fn read_content(&self, path: &str, range: Option<ByteRange>) -> anyhow::Result<Bytes> {
        let full = self.root.join(path);
        let data = tokio::fs::read(full).await?;
        Ok(apply_range(data, range))
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;

    fn virage_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap() // crates/
            .parent()
            .unwrap() // virage/
            .to_path_buf()
    }

    /// Use the engine crate itself as a small, stable test directory.
    fn engine_crate_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).to_path_buf()
    }

    #[tokio::test]
    async fn current_revision_returns_hex_string() {
        let p = LocalFsSourceProvider::new(engine_crate_root(), "localfs");
        let rev = p.current_revision().await.unwrap();
        assert!(!rev.is_empty());
        assert_eq!(rev.len(), 64, "SHA-256 hex should be 64 chars");
        assert!(rev.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn current_revision_is_deterministic() {
        let p = LocalFsSourceProvider::new(engine_crate_root(), "localfs");
        let r1 = p.current_revision().await.unwrap();
        let r2 = p.current_revision().await.unwrap();
        assert_eq!(r1, r2, "same tree must produce same manifest hash");
    }

    #[tokio::test]
    async fn file_revisions_sha256_for_known_file() {
        let p = LocalFsSourceProvider::new(virage_root(), "localfs");
        let revs = p.file_revisions(&["Cargo.toml"]).await.unwrap();
        let sha = revs.get("Cargo.toml").expect("Cargo.toml must exist");
        assert_eq!(sha.len(), 64, "SHA-256 hex should be 64 chars");
        assert!(sha.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn file_revisions_deterministic() {
        let p = LocalFsSourceProvider::new(virage_root(), "localfs");
        let r1 = p.file_revisions(&["Cargo.toml"]).await.unwrap();
        let r2 = p.file_revisions(&["Cargo.toml"]).await.unwrap();
        assert_eq!(r1, r2, "same content must produce same hash");
    }

    #[tokio::test]
    async fn file_revisions_missing_file_not_in_result() {
        let p = LocalFsSourceProvider::new(virage_root(), "localfs");
        let revs = p
            .file_revisions(&["nonexistent-file-that-does-not-exist.txt"])
            .await
            .unwrap();
        assert!(revs.is_empty());
    }

    #[tokio::test]
    async fn changed_since_always_returns_none() {
        let p = LocalFsSourceProvider::new(engine_crate_root(), "localfs");
        let result = p.changed_since("any-revision-token").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn list_all_includes_cargo_toml() {
        let p = LocalFsSourceProvider::new(engine_crate_root(), "localfs");
        let items: Vec<_> = p.list_all(None).collect().await;
        let has_cargo = items
            .iter()
            .any(|r| r.as_ref().map(|i| i.path == "Cargo.toml").unwrap_or(false));
        assert!(has_cargo, "should find Cargo.toml");
    }

    #[tokio::test]
    async fn list_all_filter_include_restricts_to_rs_files() {
        let p = LocalFsSourceProvider::new(engine_crate_root(), "localfs");
        let filter = SourceFilter {
            include: Some(vec!["**/*.rs".to_string()]),
            ignore: vec![],
        };
        let items: Vec<_> = p.list_all(Some(filter)).collect().await;
        assert!(!items.is_empty(), "should find .rs files");
        let all_rs = items
            .iter()
            .all(|r| r.as_ref().map(|i| i.path.ends_with(".rs")).unwrap_or(true));
        assert!(all_rs, "all items should be .rs files");
    }

    #[tokio::test]
    async fn list_all_ignore_filter_excludes_toml() {
        let p = LocalFsSourceProvider::new(engine_crate_root(), "localfs");
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
    async fn read_content_returns_file_bytes() {
        let p = LocalFsSourceProvider::new(virage_root(), "localfs");
        let content = p.read_content("Cargo.toml", None).await.unwrap();
        assert!(!content.is_empty());
        let text = std::str::from_utf8(&content).unwrap();
        assert!(text.contains("[workspace]"));
    }

    #[tokio::test]
    async fn read_content_byte_range_returns_slice() {
        let p = LocalFsSourceProvider::new(virage_root(), "localfs");
        let full = p.read_content("Cargo.toml", None).await.unwrap();
        let partial = p
            .read_content("Cargo.toml", Some(ByteRange { start: 0, end: 5 }))
            .await
            .unwrap();
        assert_eq!(partial.len(), 5);
        assert_eq!(&partial[..], &full[..5]);
    }
}
