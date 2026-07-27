//! MCP tool surface — shared between CE's stdio `virage serve` and any HTTP
//! transport built on top (EE). Callers own transport, session, and auth;
//! this module only knows how to answer `tools/list` and `tools/call`.
//!
//! Tool output follows a small set of agent-facing conventions, applied
//! consistently across all tools rather than left to each handler's taste:
//! - **Compact tabular output** (`toon_encode`) for list-shaped results —
//!   field names once, not repeated per row, unlike JSON array-of-objects.
//! - **Minimal default fields** per row (3-4), not the full record.
//! - **Truncation with a size hint and an escape hatch** (`full: true`) for
//!   long text, never silent truncation.
//! - **Pre-computed aggregates** (total counts) in a leading comment line,
//!   so the caller doesn't need a second call to know how much exists.
//! - **Definitive empty states**: the `name[0]{fields}:` header always
//!   prints, even with zero rows — never a bare "no results" string that a
//!   caller has to pattern-match on.

use std::sync::Arc;

use crate::db::VirageDb;
use crate::embedders::Embedder;
use crate::stores::{SearchOptions, VectorStore};

// ─── Output helpers ────────────────────────────────────────────────────────

/// Encode a uniform list of flat records as TOON (Token-Oriented Object
/// Notation): field names declared once in the header, not repeated per row.
/// Minimal subset — CSV-style cells, quoted when they contain `,`/`"`/`\n`.
fn toon_encode(name: &str, fields: &[&str], rows: &[Vec<String>]) -> String {
    let mut out = format!("{name}[{}]{{{}}}:\n", rows.len(), fields.join(","));
    for row in rows {
        out.push_str("  ");
        out.push_str(
            &row.iter()
                .map(|c| toon_escape(c))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push('\n');
    }
    out
}

fn toon_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Truncate `text` to `max_chars`, returning the (possibly truncated) text
/// plus a hint suffix when truncation happened — never silent.
fn truncate_with_hint(text: &str, max_chars: usize) -> String {
    let total = text.chars().count();
    if total <= max_chars {
        return text.to_string();
    }
    let head: String = text.chars().take(max_chars).collect();
    format!("{head}… ({total} chars total, pass full:true for complete text)")
}

// ─── Tool definitions ──────────────────────────────────────────────────────

pub fn tools_list() -> serde_json::Value {
    serde_json::json!({
        "tools": [
            {
                "name": "search_chunks",
                "description": "Semantic search over indexed source files and documents. \
                    Returns compact TOON-encoded results (path, score, snippet); snippets \
                    over 500 chars are truncated with a hint — pass full:true for complete text.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Natural-language search query."
                        },
                        "top_k": {
                            "type": "integer",
                            "description": "Max results to return (default 5)."
                        },
                        "full": {
                            "type": "boolean",
                            "description": "Return full chunk text instead of a 500-char \
                                truncated snippet (default false)."
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "browse_chunks",
                "description": "List indexed source files and their revision hashes, with a \
                    total-indexed-file count. Returns compact TOON-encoded results.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "filter": {
                            "type": "string",
                            "description": "Optional path substring filter."
                        }
                    }
                }
            },
            {
                "name": "get_stats",
                "description": "Return index statistics: file count and vector store info.",
                "inputSchema": { "type": "object", "properties": {} }
            }
        ]
    })
}

fn open_state_db(path: &str) -> anyhow::Result<VirageDb> {
    VirageDb::open(std::path::Path::new(path))
        .map_err(|e| anyhow::anyhow!("Cannot open state DB {:?}: {e}", path))
}

/// Handle a `tools/call` request.
///
/// `tag_filter` scopes the search to a caller-resolved set of tags (e.g. an
/// HTTP transport's RBAC label filter, built from a signed JWT — never from
/// request parameters). `None` means unfiltered, matching CE's stdio server.
pub async fn tool_call(
    name: &str,
    args: &serde_json::Value,
    embedder: &Arc<std::sync::Mutex<dyn Embedder + Send>>,
    store: &Arc<dyn VectorStore>,
    db_path: &str,
    tag_filter: Option<Vec<String>>,
) -> Result<serde_json::Value, serde_json::Value> {
    match name {
        "search_chunks" => {
            let query = args["query"].as_str().unwrap_or_default().to_string();
            if query.is_empty() {
                return Err(serde_json::json!({"code":-32602,"message":"query is required"}));
            }
            let top_k = args["top_k"].as_u64().unwrap_or(5) as usize;
            let full = args["full"].as_bool().unwrap_or(false);
            let vec = embedder
                .lock()
                .map_err(|_| serde_json::json!({"code":-32603,"message":"embedder lock poisoned"}))?
                .embed_batch(std::slice::from_ref(&query))
                .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?;
            let opts = SearchOptions {
                filter: None,
                tag_filter,
                hybrid: false,
                hybrid_alpha: 0.6,
                query_text: None,
            };
            let results = store
                .search(&vec, top_k, opts)
                .await
                .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?;

            let max_chars = if full { usize::MAX } else { 500 };
            let rows: Vec<Vec<String>> = results
                .iter()
                .map(|r| {
                    let src = r.source_file.as_deref().unwrap_or("unknown").to_string();
                    let score = format!("{:.3}", r.similarity);
                    let snippet = truncate_with_hint(&r.dense_text, max_chars);
                    vec![src, score, snippet]
                })
                .collect();

            let mut text = format!("# requested={top_k} returned={}\n", rows.len());
            text.push_str(&toon_encode(
                "results",
                &["path", "score", "snippet"],
                &rows,
            ));
            Ok(serde_json::json!({"content":[{"type":"text","text":text}]}))
        }
        "browse_chunks" => {
            let filter = args["filter"].as_str().map(str::to_lowercase);
            let path = db_path.to_string();
            let revisions = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
                let db = open_state_db(&path)?;
                db.get_file_revisions()
                    .map_err(|e| anyhow::anyhow!("DB error: {e}"))
            })
            .await
            .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?
            .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?;
            let total_indexed = revisions.len();
            let mut files: Vec<_> = revisions
                .iter()
                .filter(|(k, _)| {
                    filter
                        .as_ref()
                        .is_none_or(|f| k.to_lowercase().contains(f.as_str()))
                })
                .collect();
            files.sort_by_key(|(k, _)| k.as_str());

            let rows: Vec<Vec<String>> = files
                .iter()
                .map(|(p, rev)| vec![(*p).clone(), rev.chars().take(8).collect::<String>()])
                .collect();

            let mut text = format!("# total_indexed={total_indexed} matched={}\n", rows.len());
            text.push_str(&toon_encode("files", &["path", "revision"], &rows));
            Ok(serde_json::json!({"content":[{"type":"text","text":text}]}))
        }
        "get_stats" => {
            let path = db_path.to_string();
            let file_count = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
                let db = open_state_db(&path)?;
                db.get_file_revisions()
                    .map(|m| m.len())
                    .map_err(|e| anyhow::anyhow!("DB error: {e}"))
            })
            .await
            .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?
            .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?;
            let store_state = store
                .current_state()
                .await
                .map_err(|e| serde_json::json!({"code":-32603,"message":e.to_string()}))?;

            let rows = vec![vec![file_count.to_string(), store_state.len().to_string()]];
            let text = toon_encode("stats", &["indexed_files", "store_entries"], &rows);
            Ok(serde_json::json!({"content":[{"type":"text","text":text}]}))
        }
        _ => Err(serde_json::json!({"code":-32602,"message":format!("Unknown tool: {name}")})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toon_encode_empty_is_explicit() {
        let out = toon_encode("results", &["path", "score"], &[]);
        assert_eq!(out, "results[0]{path,score}:\n");
    }

    #[test]
    fn toon_encode_quotes_commas_and_quotes() {
        let rows = vec![vec!["a,b".to_string(), "has \"quote\"".to_string()]];
        let out = toon_encode("x", &["a", "b"], &rows);
        assert_eq!(out, "x[1]{a,b}:\n  \"a,b\",\"has \"\"quote\"\"\"\n");
    }

    #[test]
    fn truncate_with_hint_passes_short_text_through() {
        assert_eq!(truncate_with_hint("hello", 500), "hello");
    }

    #[test]
    fn truncate_with_hint_adds_size_hint_when_truncated() {
        let text = "x".repeat(600);
        let out = truncate_with_hint(&text, 500);
        assert!(out.starts_with(&"x".repeat(500)));
        assert!(out.contains("600 chars total"));
        assert!(out.contains("full:true"));
    }
}
