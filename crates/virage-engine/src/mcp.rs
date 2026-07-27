//! MCP tool surface — shared between CE's stdio `virage serve` and any HTTP
//! transport built on top (EE). Callers own transport, session, and auth;
//! this module only knows how to answer `tools/list` and `tools/call`.

use std::sync::Arc;

use crate::db::VirageDb;
use crate::embedders::Embedder;
use crate::stores::{SearchOptions, VectorStore};

pub fn tools_list() -> serde_json::Value {
    serde_json::json!({
        "tools": [
            {
                "name": "search_chunks",
                "description": "Semantic search over indexed source files and documents.",
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
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "browse_chunks",
                "description": "List indexed source files and their revision hashes.",
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
            let text = if results.is_empty() {
                "No results found.".to_string()
            } else {
                results
                    .iter()
                    .enumerate()
                    .map(|(i, r)| {
                        let src = r.source_file.as_deref().unwrap_or("unknown");
                        let snippet = if r.dense_text.len() > 500 {
                            format!("{}…", &r.dense_text[..500])
                        } else {
                            r.dense_text.clone()
                        };
                        format!(
                            "[{}] {}  (similarity: {:.1}%)\n{}",
                            i + 1,
                            src,
                            r.similarity * 100.0,
                            snippet
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n---\n")
            };
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
            let mut files: Vec<_> = revisions
                .iter()
                .filter(|(k, _)| {
                    filter
                        .as_ref()
                        .is_none_or(|f| k.to_lowercase().contains(f.as_str()))
                })
                .collect();
            files.sort_by_key(|(k, _)| k.as_str());
            let text = if files.is_empty() {
                "No indexed files found.".to_string()
            } else {
                files
                    .iter()
                    .map(|(p, rev)| format!("{p}  [{}]", &rev[..rev.len().min(8)]))
                    .collect::<Vec<_>>()
                    .join("\n")
            };
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
            let text = format!(
                "Indexed files : {file_count}\nStore entries : {}",
                store_state.len(),
            );
            Ok(serde_json::json!({"content":[{"type":"text","text":text}]}))
        }
        _ => Err(serde_json::json!({"code":-32602,"message":format!("Unknown tool: {name}")})),
    }
}
