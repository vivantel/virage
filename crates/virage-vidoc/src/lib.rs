use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Raw file data plus metadata, produced by [`read_for_chunker`].
/// Each chunker's napi binding reads this once and passes the bytes to its
/// format-specific parser — no data crosses the JS/Rust boundary.
pub struct FileInfo {
    pub bytes: Vec<u8>,
    /// SHA-256 hex digest of the raw file bytes.
    pub hash: String,
    /// File size in bytes (as f64 so napi callers get a JS Number, not BigInt).
    pub size: f64,
    /// Last-modified time as milliseconds since Unix epoch.
    pub modified_ms: f64,
}

/// Read a file and compute its SHA-256 hash and metadata in one pass.
///
/// # Errors
/// Returns a descriptive string on I/O failure.
pub fn read_for_chunker(path: &str) -> Result<FileInfo, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    let meta = std::fs::metadata(path).map_err(|e| format!("cannot stat {path}: {e}"))?;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = format!("{:x}", hasher.finalize());

    let size = meta.len() as f64;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);

    Ok(FileInfo {
        bytes,
        hash,
        size,
        modified_ms,
    })
}

/// Every node type in the ViDoc AST.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DocNodeType {
    Document,
    Section,
    Heading,
    Paragraph,
    Table,
    TableRow,
    TableCell,
    List,
    ListItem,
    Code,
    Formula,
    Image,
    Link,
    Footnote,
    Caption,
    Abstract,
    Metadata,
}

/// Semantic role of a node (used for structural nodes that aren't headings).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NodeRole {
    Caption,
    Footnote,
    Abstract,
    TocEntry,
    Header,
    Footer,
}

/// Per-node attribute bag.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DocNodeAttrs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading_level: Option<u8>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<NodeRole>,

    /// Ancestor heading texts from outermost to innermost.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub breadcrumb: Option<Vec<String>>,

    /// Byte offset of first byte in source file.
    pub byte_start: u64,
    /// Byte offset one past last byte.
    pub byte_end: u64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_end: Option<u32>,

    /// 1-based page number (paginated formats: PDF, DOCX).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_number: Option<u32>,

    /// BCP-47 language tag, e.g. "en", "de", "zh-Hans".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,

    /// Programming language identifier for code nodes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_language: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_row: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_col: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_header: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_depth: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ordered: Option<bool>,

    /// Source format of the original document.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_format: Option<String>,
}

/// A node in the ViDoc AST.
///
/// Structural nodes (document, section, heading, table, list, …) carry `children`.
/// Leaf nodes (paragraph, table-cell, list-item, code, formula, …) carry `text`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocNode {
    #[serde(rename = "type")]
    pub node_type: DocNodeType,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<DocNode>>,

    /// Leaf text content.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,

    pub attrs: DocNodeAttrs,
}

impl DocNode {
    /// Serialize the tree to JSON (the Rust↔JS boundary format).
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Deserialize from JSON received from a TypeScript caller.
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_json() {
        let node = DocNode {
            node_type: DocNodeType::Paragraph,
            children: None,
            text: Some("Hello world".to_string()),
            attrs: DocNodeAttrs {
                byte_start: 0,
                byte_end: 11,
                breadcrumb: Some(vec!["Introduction".to_string()]),
                ..Default::default()
            },
        };
        let json = node.to_json().unwrap();
        let back = DocNode::from_json(&json).unwrap();
        assert_eq!(node, back);
    }
}
