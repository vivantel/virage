use std::collections::HashMap;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use virage_vidoc::{DocNode, DocNodeType};

// ─── TextSegment (from ast-walker.ts) ────────────────────────────────────────

#[derive(Clone)]
struct TextSegment {
    text: String,
    node_type: DocNodeType,
    byte_start: u64,
    byte_end: u64,
    line_start: Option<u32>,
    line_end: Option<u32>,
    page_number: Option<u32>,
    lang: Option<String>,
    code_language: Option<String>,
    breadcrumb: Vec<String>,
}

// ─── WalkOptions ─────────────────────────────────────────────────────────────

/// Options for `walk_to_chunks`, mirroring `WalkOptions` in `chunker.ts`.
pub struct WalkOptions<'a> {
    pub source_file: &'a str,
    pub source_format: &'a str,
    pub commit_hash: &'a str,
    pub strategy: &'a str,
    pub sparse_text_generator_id: &'a str,
    pub metadata_generator_id: &'a str,
    pub max_tokens: usize,
    /// Defaults to `max_tokens / 4` when `None`.
    pub min_tokens: Option<usize>,
    /// Sliding-window overlap fraction in [0, 0.9].
    pub overlap: f32,
    pub recursive: bool,
    pub adaptive_size: bool,
    pub file_hash: Option<&'a str>,
    pub file_size_bytes: Option<u64>,
    pub file_modified_at: Option<&'a str>,
}

impl<'a> Default for WalkOptions<'a> {
    fn default() -> Self {
        Self {
            source_file: "",
            source_format: "",
            commit_hash: "",
            strategy: "window",
            sparse_text_generator_id: "",
            metadata_generator_id: "",
            max_tokens: 512,
            min_tokens: None,
            overlap: 0.0,
            recursive: false,
            adaptive_size: false,
            file_hash: None,
            file_size_bytes: None,
            file_modified_at: None,
        }
    }
}

impl<'a> WalkOptions<'a> {
    fn resolved_min_tokens(&self) -> usize {
        self.min_tokens.unwrap_or(self.max_tokens / 4)
    }
}

// ─── ArtifactSet ─────────────────────────────────────────────────────────────

/// Atomic output unit of `walk_to_chunks` — one per logical window.
///
/// Matches `ArtifactSet` in `virage-chunker-ce-ast/src/types.ts`.
pub struct ArtifactSet {
    pub dense_text: String,
    pub sparse_text: String,
    pub dense_text_hash: String,
    pub sparse_text_generator_id: String,
    pub metadata_generator_id: String,
    pub metadata: HashMap<String, Value>,
    pub source_file: String,
    pub commit_hash: String,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN: usize = 4;

fn estimate_tokens(text: &str) -> usize {
    text.len().div_ceil(CHARS_PER_TOKEN)
}

fn make_dense_text(breadcrumb: &[String], raw: &str) -> String {
    if breadcrumb.is_empty() {
        raw.to_string()
    } else {
        format!("{}. {}", breadcrumb.join(" › "), raw)
    }
}

fn compute_dense_text_hash(text: &str) -> String {
    let h = Sha256::digest(text.as_bytes());
    let hex: String = h.iter().map(|b| format!("{b:02x}")).collect();
    hex[..16].to_string()
}

/// Adjust `i` down to the nearest UTF-8 character boundary.
fn floor_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

// ─── extractOutline (outline.ts) ─────────────────────────────────────────────

/// Extract top-level section titles from the ViDoc tree.
pub fn extract_outline(root: &DocNode) -> Vec<String> {
    let mut titles = Vec::new();
    for child in root.children.as_deref().unwrap_or(&[]) {
        match child.node_type {
            DocNodeType::Heading if child.attrs.heading_level == Some(1) => {
                if let Some(t) = &child.text {
                    titles.push(t.clone());
                }
            }
            DocNodeType::Section => {
                let h = child
                    .children
                    .as_deref()
                    .unwrap_or(&[])
                    .iter()
                    .find(|n| n.node_type == DocNodeType::Heading && n.text.is_some());
                if let Some(h) = h {
                    if let Some(t) = &h.text {
                        titles.push(t.clone());
                    }
                }
            }
            _ => {}
        }
    }
    titles
}

// ─── walkDocNode (ast-walker.ts) ─────────────────────────────────────────────

fn walk_doc_node(root: &DocNode) -> Vec<TextSegment> {
    let mut segs = Vec::new();
    let mut breadcrumb: Vec<String> = Vec::new();
    visit(root, &mut breadcrumb, &mut segs);
    segs
}

fn visit(node: &DocNode, breadcrumb: &mut Vec<String>, out: &mut Vec<TextSegment>) {
    if node.node_type == DocNodeType::Heading {
        if let Some(text) = &node.text {
            let level = node.attrs.heading_level.unwrap_or(1) as usize;
            breadcrumb.truncate(level.saturating_sub(1));
            breadcrumb.push(text.clone());
        }
    }

    let is_leaf = node.text.is_some()
        && !matches!(
            node.node_type,
            DocNodeType::Heading | DocNodeType::Image | DocNodeType::Link
        );

    if is_leaf {
        if let Some(text) = &node.text {
            if !text.is_empty() {
                out.push(TextSegment {
                    text: text.clone(),
                    node_type: node.node_type.clone(),
                    byte_start: node.attrs.byte_start,
                    byte_end: node.attrs.byte_end,
                    line_start: node.attrs.line_start,
                    line_end: node.attrs.line_end,
                    page_number: node.attrs.page_number,
                    lang: node.attrs.lang.clone(),
                    code_language: node.attrs.code_language.clone(),
                    breadcrumb: breadcrumb.clone(),
                });
            }
        }
    }

    for child in node.children.as_deref().unwrap_or(&[]) {
        visit(child, breadcrumb, out);
    }
}

// ─── splitOversized ──────────────────────────────────────────────────────────

fn split_oversized(seg: &TextSegment, max_tokens: usize) -> Vec<TextSegment> {
    let max_bytes = max_tokens * CHARS_PER_TOKEN;
    if seg.text.len() <= max_bytes {
        return vec![seg.clone()];
    }
    let mut parts = Vec::new();
    let mut pos = 0usize;
    while pos < seg.text.len() {
        let raw_end = (pos + max_bytes).min(seg.text.len());
        let end = floor_char_boundary(&seg.text, raw_end);
        let text = seg.text[pos..end].to_string();
        let len = text.len();
        parts.push(TextSegment {
            text,
            byte_start: seg.byte_start + pos as u64,
            byte_end: seg.byte_start + (pos + len) as u64,
            ..seg.clone()
        });
        if len == 0 {
            break; // safety
        }
        pos += len;
    }
    parts
}

// ─── Window ───────────────────────────────────────────────────────────────────

struct Window {
    texts: Vec<String>,
    byte_start: u64,
    byte_end: u64,
    line_start: Option<u32>,
    line_end: Option<u32>,
    page_start: Option<u32>,
    page_end: Option<u32>,
    breadcrumb: Vec<String>,
    lang: Option<String>,
    code_language: Option<String>,
    truncated: bool,
}

// ─── walk_to_chunks ───────────────────────────────────────────────────────────

/// Port of `walkToChunks` from `virage-chunker-ce-ast/src/chunker.ts`.
///
/// Walks the ViDoc AST and produces one `ArtifactSet` per logical window.
/// Uses byte-length for token estimation (`bytes / 4`), matching the TS impl.
pub fn walk_to_chunks(root: &DocNode, opts: &WalkOptions) -> Vec<ArtifactSet> {
    let max_tokens = opts.max_tokens;
    let min_tokens = opts.resolved_min_tokens();
    let overlap = opts.overlap.clamp(0.0, 0.9);
    let adaptive_size = opts.adaptive_size;

    let document_outline = extract_outline(root);

    let raw_segs = walk_doc_node(root);
    if raw_segs.is_empty() {
        return Vec::new();
    }

    let segments: Vec<TextSegment> = if opts.recursive {
        raw_segs
            .iter()
            .flat_map(|s| split_oversized(s, max_tokens))
            .collect()
    } else {
        raw_segs
    };

    // ── Build windows ─────────────────────────────────────────────────────────
    let mut windows: Vec<Window> = Vec::new();
    let mut start_idx = 0usize;

    while start_idx < segments.len() {
        let first = &segments[start_idx];
        let mut win = Window {
            texts: Vec::new(),
            byte_start: first.byte_start,
            byte_end: first.byte_end,
            breadcrumb: first.breadcrumb.clone(),
            line_start: None,
            line_end: None,
            page_start: None,
            page_end: None,
            lang: None,
            code_language: None,
            truncated: false,
        };
        let mut current_tokens = 0usize;
        let mut idx = start_idx;

        while idx < segments.len() {
            let seg = &segments[idx];
            let is_compact = adaptive_size
                && matches!(seg.node_type, DocNodeType::Code | DocNodeType::TableCell);
            let effective_max = if is_compact {
                max_tokens.div_ceil(2)
            } else {
                max_tokens
            };
            let seg_tokens = estimate_tokens(&seg.text);

            // Flush on section boundary.
            if current_tokens > 0 && seg.breadcrumb != win.breadcrumb {
                break;
            }

            // Flush if adding this segment would overflow.
            if current_tokens > 0 && current_tokens + seg_tokens > effective_max {
                break;
            }

            // Hard-cut a single oversized segment (recursive=false path).
            if seg_tokens > max_tokens {
                let max_bytes = max_tokens * CHARS_PER_TOKEN;
                let end = floor_char_boundary(&seg.text, max_bytes);
                win.texts.push(seg.text[..end].to_string());
                win.byte_end = seg.byte_end;
                win.truncated = true;
                idx += 1;
                break;
            }

            win.texts.push(seg.text.clone());
            win.byte_end = seg.byte_end;
            if win.line_start.is_none() {
                win.line_start = seg.line_start;
            }
            if seg.line_end.is_some() {
                win.line_end = seg.line_end;
            }
            if win.page_start.is_none() {
                win.page_start = seg.page_number;
            }
            if seg.page_number.is_some() {
                win.page_end = seg.page_number;
            }
            if win.lang.is_none() {
                win.lang = seg.lang.clone();
            }
            if win.code_language.is_none() {
                win.code_language = seg.code_language.clone();
            }
            current_tokens += seg_tokens;
            idx += 1;
        }

        if !win.texts.is_empty() {
            windows.push(win);

            if overlap > 0.0 && idx > start_idx + 1 {
                // Walk backwards to find the overlap point.
                let target = (current_tokens as f32 * overlap) as usize;
                let mut accumulated = 0usize;
                let mut back = idx - 1;
                while back > start_idx && accumulated < target {
                    accumulated += estimate_tokens(&segments[back].text);
                    back -= 1;
                }
                start_idx = (start_idx + 1).max(back + 1);
            } else {
                start_idx = idx;
            }
        } else {
            start_idx += 1; // safety: always advance
        }
    }

    // ── Merge short trailing window into predecessor (same section) ────────────
    if windows.len() > 1 {
        let last_tokens = estimate_tokens(&windows.last().unwrap().texts.join("\n\n"));
        let same_bc =
            windows[windows.len() - 1].breadcrumb == windows[windows.len() - 2].breadcrumb;
        if last_tokens < min_tokens && same_bc {
            let last = windows.pop().unwrap();
            let prev = windows.last_mut().unwrap();
            prev.texts.extend(last.texts);
            prev.byte_end = last.byte_end;
            prev.line_end = last.line_end;
            prev.page_end = last.page_end;
        }
    }

    let total = windows.len();

    // ── Build ArtifactSet[] ───────────────────────────────────────────────────
    let mut artifacts: Vec<ArtifactSet> = windows
        .iter()
        .enumerate()
        .map(|(i, win)| {
            let raw = win.texts.join("\n\n");
            let dense_text = make_dense_text(&win.breadcrumb, &raw);
            let dense_text_hash = compute_dense_text_hash(&dense_text);

            let mut meta: HashMap<String, Value> = HashMap::new();
            meta.insert("sourceFile".into(), json!(opts.source_file));
            meta.insert("sourceFormat".into(), json!(opts.source_format));
            meta.insert("breadcrumb".into(), json!(win.breadcrumb));
            meta.insert("byteStart".into(), json!(win.byte_start));
            meta.insert("byteEnd".into(), json!(win.byte_end));
            if let Some(v) = win.line_start {
                meta.insert("lineStart".into(), json!(v));
            }
            if let Some(v) = win.line_end {
                meta.insert("lineEnd".into(), json!(v));
            }
            if let Some(v) = win.page_start {
                meta.insert("pageStart".into(), json!(v));
            }
            if let Some(v) = win.page_end {
                meta.insert("pageEnd".into(), json!(v));
            }
            if let Some(ref v) = win.lang {
                meta.insert("lang".into(), json!(v));
            }
            if let Some(ref v) = win.code_language {
                meta.insert("codeLanguage".into(), json!(v));
            }
            meta.insert("chunkIndex".into(), json!(i));
            meta.insert("totalChunks".into(), json!(total));
            meta.insert("strategy".into(), json!(opts.strategy));
            meta.insert("estimatedTokens".into(), json!(estimate_tokens(&raw)));
            if let Some(v) = opts.file_hash {
                meta.insert("fileHash".into(), json!(v));
            }
            if let Some(v) = opts.file_modified_at {
                meta.insert("fileModifiedAt".into(), json!(v));
            }
            if let Some(v) = opts.file_size_bytes {
                meta.insert("fileSizeBytes".into(), json!(v));
            }
            // ChunkMeta extras
            if let Some(title) = win.breadcrumb.last() {
                meta.insert("sectionTitle".into(), json!(title));
            }
            if !win.breadcrumb.is_empty() {
                meta.insert("headingLevel".into(), json!(win.breadcrumb.len()));
            }
            if !document_outline.is_empty() {
                meta.insert("documentOutline".into(), json!(document_outline));
            }
            if win.truncated {
                meta.insert("truncated".into(), json!(true));
            }

            ArtifactSet {
                dense_text,
                sparse_text: raw,
                dense_text_hash,
                sparse_text_generator_id: opts.sparse_text_generator_id.to_string(),
                metadata_generator_id: opts.metadata_generator_id.to_string(),
                metadata: meta,
                source_file: opts.source_file.to_string(),
                commit_hash: opts.commit_hash.to_string(),
            }
        })
        .collect();

    // ── Assign sibling IDs ────────────────────────────────────────────────────
    let hashes: Vec<String> = artifacts
        .iter()
        .map(|a| a.dense_text_hash.clone())
        .collect();
    for (i, artifact) in artifacts.iter_mut().enumerate() {
        let prev = i.checked_sub(1).map(|j| hashes[j].as_str());
        let next = hashes.get(i + 1).map(|s| s.as_str());
        if let Some(h) = prev {
            artifact.metadata.insert("siblingPrev".into(), json!(h));
        }
        if let Some(h) = next {
            artifact.metadata.insert("siblingNext".into(), json!(h));
        }
        let ids: Vec<&str> = [prev, next].into_iter().flatten().collect();
        if !ids.is_empty() {
            artifact.metadata.insert("siblingIds".into(), json!(ids));
        }
    }

    artifacts
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use virage_vidoc::DocNodeAttrs;

    use super::*;

    fn make_node(
        node_type: DocNodeType,
        text: Option<&str>,
        heading_level: Option<u8>,
        children: Option<Vec<DocNode>>,
    ) -> DocNode {
        DocNode {
            node_type,
            text: text.map(str::to_string),
            children,
            attrs: DocNodeAttrs {
                heading_level,
                byte_start: 0,
                byte_end: text.map(|t| t.len() as u64).unwrap_or(0),
                ..Default::default()
            },
        }
    }

    fn para(text: &str) -> DocNode {
        make_node(DocNodeType::Paragraph, Some(text), None, None)
    }

    fn heading(level: u8, text: &str) -> DocNode {
        make_node(DocNodeType::Heading, Some(text), Some(level), None)
    }

    fn doc(children: Vec<DocNode>) -> DocNode {
        make_node(DocNodeType::Document, None, None, Some(children))
    }

    fn opts<'a>() -> WalkOptions<'a> {
        WalkOptions {
            source_file: "test.md",
            source_format: "md",
            commit_hash: "abc123",
            strategy: "window",
            sparse_text_generator_id: "gen_v1",
            metadata_generator_id: "meta_v1",
            max_tokens: 10, // small for tests
            ..Default::default()
        }
    }

    #[test]
    fn empty_doc_returns_no_chunks() {
        let root = doc(vec![]);
        let result = walk_to_chunks(&root, &opts());
        assert!(result.is_empty());
    }

    #[test]
    fn single_paragraph_produces_one_chunk() {
        let root = doc(vec![para("hello world")]);
        let result = walk_to_chunks(&root, &opts());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].sparse_text, "hello world");
        assert_eq!(result[0].dense_text, "hello world");
        assert_eq!(result[0].source_file, "test.md");
        assert_eq!(result[0].commit_hash, "abc123");
    }

    #[test]
    fn dense_text_hash_is_16_hex_chars() {
        let root = doc(vec![para("hello world")]);
        let result = walk_to_chunks(&root, &opts());
        let hash = &result[0].dense_text_hash;
        assert_eq!(hash.len(), 16);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn heading_sets_breadcrumb_in_dense_text() {
        let root = doc(vec![heading(1, "Introduction"), para("Some text here.")]);
        let result = walk_to_chunks(&root, &opts());
        assert_eq!(result.len(), 1);
        assert!(
            result[0].dense_text.starts_with("Introduction."),
            "dense_text = {:?}",
            result[0].dense_text
        );
        let bc = result[0]
            .metadata
            .get("breadcrumb")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(bc[0].as_str().unwrap(), "Introduction");
    }

    #[test]
    fn section_boundary_flushes_window() {
        let many_paras_sec1: Vec<DocNode> = (0..5).map(|i| para(&format!("para {i}"))).collect();
        let many_paras_sec2: Vec<DocNode> = (5..10).map(|i| para(&format!("para {i}"))).collect();

        let mut children = vec![heading(1, "Section A")];
        children.extend(many_paras_sec1);
        children.push(heading(1, "Section B"));
        children.extend(many_paras_sec2);

        let root = doc(children);
        let mut o = opts();
        o.max_tokens = 1000; // big enough to fit all in one window per section

        let result = walk_to_chunks(&root, &o);
        // Two sections → at minimum two windows (one per section)
        assert!(result.len() >= 2, "got {} chunks", result.len());
        // First chunk should be in section A
        let bc0 = result[0]
            .metadata
            .get("breadcrumb")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(bc0[0].as_str().unwrap(), "Section A");
    }

    #[test]
    fn overflow_splits_into_multiple_windows() {
        // 5 paragraphs of "word " (5 bytes each) → ~2 tokens each.
        // max_tokens=4 → each window holds ~2 paragraphs.
        let paras: Vec<DocNode> = (0..5).map(|_| para("word word")).collect();
        let root = doc(paras);
        let mut o = opts();
        o.max_tokens = 4;

        let result = walk_to_chunks(&root, &o);
        assert!(
            result.len() > 1,
            "expected multiple windows, got {}",
            result.len()
        );
    }

    #[test]
    fn sibling_ids_link_adjacent_chunks() {
        let paras: Vec<DocNode> = (0..10)
            .map(|i| para(&format!("paragraph {i} text")))
            .collect();
        let root = doc(paras);
        let mut o = opts();
        o.max_tokens = 8;

        let result = walk_to_chunks(&root, &o);
        assert!(result.len() >= 2);

        // First chunk has siblingNext but no siblingPrev.
        assert!(result[0].metadata.contains_key("siblingNext"));
        assert!(!result[0].metadata.contains_key("siblingPrev"));

        // Last chunk has siblingPrev but no siblingNext.
        let last = result.last().unwrap();
        assert!(last.metadata.contains_key("siblingPrev"));
        assert!(!last.metadata.contains_key("siblingNext"));
    }

    #[test]
    fn metadata_contains_required_fields() {
        let root = doc(vec![para("hello")]);
        let result = walk_to_chunks(&root, &opts());
        let meta = &result[0].metadata;
        assert!(meta.contains_key("sourceFile"));
        assert!(meta.contains_key("sourceFormat"));
        assert!(meta.contains_key("chunkIndex"));
        assert!(meta.contains_key("totalChunks"));
        assert!(meta.contains_key("strategy"));
        assert!(meta.contains_key("estimatedTokens"));
        assert_eq!(meta["sourceFile"].as_str().unwrap(), "test.md");
    }

    #[test]
    fn short_trailing_window_merged_into_predecessor() {
        // Create text that fills most of a window, then a tiny remainder
        // all in the same section.
        let text_big = "abcd".repeat(10); // 40 bytes = 10 tokens
        let text_tiny = "x"; // 1 byte = 1 token
        let root = doc(vec![para(&text_big), para(&text_tiny)]);
        let mut o = opts();
        o.max_tokens = 10; // big fills exactly one window, tiny goes to next
        o.min_tokens = Some(3); // tiny (1 token) < min (3) → merge

        let result = walk_to_chunks(&root, &o);
        // With merging, we expect 1 chunk (tiny merged into big).
        assert_eq!(
            result.len(),
            1,
            "expected merge; got {} chunks",
            result.len()
        );
    }

    #[test]
    fn extract_outline_returns_h1_titles() {
        let root = doc(vec![
            heading(1, "Chapter One"),
            para("content"),
            heading(2, "Sub-section"),
            heading(1, "Chapter Two"),
        ]);
        let outline = extract_outline(&root);
        assert_eq!(outline, vec!["Chapter One", "Chapter Two"]);
    }

    #[test]
    fn recursive_mode_pre_splits_oversized() {
        let long_text = "a".repeat(200); // 200 bytes = 50 tokens
        let root = doc(vec![para(&long_text)]);
        let mut o = opts();
        o.max_tokens = 10;
        o.recursive = true;

        let result = walk_to_chunks(&root, &o);
        // Each window ≤ 10 tokens = 40 bytes → 200/40 = 5 windows
        assert!(
            result.len() >= 4,
            "expected multiple windows from recursive split, got {}",
            result.len()
        );
        // No window exceeds max_tokens
        for r in &result {
            assert!(
                estimate_tokens(&r.sparse_text) <= 10,
                "window too large: {}",
                estimate_tokens(&r.sparse_text)
            );
        }
    }
}
