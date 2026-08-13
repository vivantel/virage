//! MCP tool surface — shared between CE's stdio `virage serve` and any HTTP
//! transport built on top (EE). Callers own transport, session, and auth;
//! this module only knows how to answer `tools/list` and `tools/call`.
//!
//! Tool output follows a small set of agent-facing conventions, applied
//! consistently across all tools rather than left to each handler's taste:
//! - **Compact tabular output** (`toon_encode`) for list-shaped results —
//!   field names once, not repeated per row, unlike JSON array-of-objects.
//!   TOON is the default; callers can pass `format:"json"` to get a plain
//!   JSON object instead (same fields and aggregates, no token savings).
//! - **Minimal default fields** per row (3-4), not the full record.
//! - **Truncation with a size hint and an escape hatch** (`full: true`) for
//!   long text, never silent truncation.
//! - **Pre-computed aggregates** (total counts) alongside the rows, so the
//!   caller doesn't need a second call to know how much exists.
//! - **Definitive empty states**: the `name[0]{fields}:` header always
//!   prints, even with zero rows — never a bare "no results" string that a
//!   caller has to pattern-match on.

use std::sync::Arc;

use crate::db::VirageDb;
use crate::embedders::Embedder;
use crate::stores::{SearchOptions, VectorStore};

// ─── Output helpers ────────────────────────────────────────────────────────

/// Output format for tool results. TOON is the default; `json` trades the
/// token savings for a shape some callers may find easier to parse.
#[derive(Clone, Copy, PartialEq, Eq)]
enum OutputFormat {
    Toon,
    Json,
}

fn parse_format(args: &serde_json::Value) -> Result<OutputFormat, serde_json::Value> {
    match args["format"].as_str() {
        None => Ok(OutputFormat::Toon),
        Some("toon") => Ok(OutputFormat::Toon),
        Some("json") => Ok(OutputFormat::Json),
        Some(other) => Err(serde_json::json!({
            "code": -32602,
            "message": format!("Unknown format {other:?}: expected \"toon\" or \"json\"")
        })),
    }
}

/// Render a uniform list of flat records plus caller-facing aggregates
/// (e.g. total counts) in the requested format, wrapped in the MCP
/// `content` envelope.
fn render_records(
    format: OutputFormat,
    name: &str,
    fields: &[&str],
    rows: &[Vec<String>],
    meta: &[(&str, serde_json::Value)],
) -> serde_json::Value {
    let text = match format {
        OutputFormat::Toon => {
            let mut out = meta
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(" ");
            if !out.is_empty() {
                out = format!("# {out}\n");
            }
            out.push_str(&toon_encode(name, fields, rows));
            out
        }
        OutputFormat::Json => {
            let records: Vec<serde_json::Value> = rows
                .iter()
                .map(|row| {
                    serde_json::Value::Object(
                        fields
                            .iter()
                            .zip(row.iter())
                            .map(|(f, v)| ((*f).to_string(), json_scalar(v)))
                            .collect(),
                    )
                })
                .collect();
            let mut obj = serde_json::Map::new();
            for (k, v) in meta {
                obj.insert((*k).to_string(), v.clone());
            }
            obj.insert(name.to_string(), serde_json::Value::Array(records));
            serde_json::to_string_pretty(&serde_json::Value::Object(obj))
                .expect("map of scalars and strings always serializes")
        }
    };
    serde_json::json!({"content":[{"type":"text","text":text}]})
}

/// Encode a uniform list of flat records as TOON (Token-Oriented Object
/// Notation): field names declared once in the header, not repeated per row.
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

/// Quote a TOON cell per the format's grammar: not just when it contains a
/// delimiter, quote, or newline, but whenever leaving it bare would make a
/// TOON parser coerce it to something other than a string — leading/trailing
/// whitespace, the empty string, the `true`/`false`/`null` literals, or
/// anything that parses as a number.
fn toon_escape(value: &str) -> String {
    let needs_quoting = value.is_empty()
        || value.contains(',')
        || value.contains('"')
        || value.contains('\n')
        || value.starts_with(char::is_whitespace)
        || value.ends_with(char::is_whitespace)
        || matches!(value, "true" | "false" | "null")
        || value.parse::<f64>().is_ok();
    if needs_quoting {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Best-effort typed JSON value for a cell: numbers and booleans round-trip
/// as their native type, everything else stays a string.
fn json_scalar(value: &str) -> serde_json::Value {
    if let Ok(n) = value.parse::<i64>() {
        serde_json::Value::Number(n.into())
    } else if let Ok(f) = value.parse::<f64>() {
        serde_json::Number::from_f64(f).map_or_else(
            || serde_json::Value::String(value.to_string()),
            serde_json::Value::Number,
        )
    } else if value == "true" || value == "false" {
        serde_json::Value::Bool(value == "true")
    } else {
        serde_json::Value::String(value.to_string())
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
                    Returns TOON-encoded results (path, score, snippet) by default, or JSON \
                    with format:\"json\"; snippets over 500 chars are truncated with a hint \
                    — pass full:true for complete text.",
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
                        },
                        "format": {
                            "type": "string",
                            "enum": ["toon", "json"],
                            "description": "Output encoding for the result set (default \"toon\")."
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "browse_chunks",
                "description": "List indexed source files and their revision hashes, with a \
                    total-indexed-file count. Returns TOON-encoded results by default, or \
                    JSON with format:\"json\".",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "filter": {
                            "type": "string",
                            "description": "Optional path substring filter."
                        },
                        "format": {
                            "type": "string",
                            "enum": ["toon", "json"],
                            "description": "Output encoding for the result set (default \"toon\")."
                        }
                    }
                }
            },
            {
                "name": "get_stats",
                "description": "Return index statistics: file count and vector store info. \
                    Returns TOON-encoded results by default, or JSON with format:\"json\".",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "format": {
                            "type": "string",
                            "enum": ["toon", "json"],
                            "description": "Output encoding for the result (default \"toon\")."
                        }
                    }
                }
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
            let format = parse_format(args)?;
            let vec = embedder
                .lock()
                .map_err(|_| serde_json::json!({"code":-32603,"message":"embedder lock poisoned"}))?
                .embed_batch(&[query.as_str()])
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

            let meta = [
                ("requested", serde_json::json!(top_k)),
                ("returned", serde_json::json!(rows.len())),
            ];
            Ok(render_records(
                format,
                "results",
                &["path", "score", "snippet"],
                &rows,
                &meta,
            ))
        }
        "browse_chunks" => {
            let filter = args["filter"].as_str().map(str::to_lowercase);
            let format = parse_format(args)?;
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

            let meta = [
                ("total_indexed", serde_json::json!(total_indexed)),
                ("matched", serde_json::json!(rows.len())),
            ];
            Ok(render_records(
                format,
                "files",
                &["path", "revision"],
                &rows,
                &meta,
            ))
        }
        "get_stats" => {
            let format = parse_format(args)?;
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
            Ok(render_records(
                format,
                "stats",
                &["indexed_files", "store_entries"],
                &rows,
                &[],
            ))
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

    #[test]
    fn toon_escape_quotes_ambiguous_scalars() {
        // Would otherwise be re-parsed as a number, bool, or null.
        assert_eq!(toon_escape("42"), "\"42\"");
        assert_eq!(toon_escape("3.14"), "\"3.14\"");
        assert_eq!(toon_escape("true"), "\"true\"");
        assert_eq!(toon_escape("false"), "\"false\"");
        assert_eq!(toon_escape("null"), "\"null\"");
        // Would otherwise lose leading/trailing whitespace or vanish entirely.
        assert_eq!(toon_escape(" pad"), "\" pad\"");
        assert_eq!(toon_escape("pad "), "\"pad \"");
        assert_eq!(toon_escape(""), "\"\"");
        // Ordinary text passes through bare.
        assert_eq!(toon_escape("hello.rs"), "hello.rs");
        assert_eq!(toon_escape("truer"), "truer");
    }

    #[test]
    fn parse_format_defaults_to_toon_and_rejects_unknown() {
        assert!(matches!(
            parse_format(&serde_json::json!({})).unwrap(),
            OutputFormat::Toon
        ));
        assert!(matches!(
            parse_format(&serde_json::json!({"format":"toon"})).unwrap(),
            OutputFormat::Toon
        ));
        assert!(matches!(
            parse_format(&serde_json::json!({"format":"json"})).unwrap(),
            OutputFormat::Json
        ));
        assert!(parse_format(&serde_json::json!({"format":"xml"})).is_err());
    }

    #[test]
    fn json_scalar_round_trips_types() {
        assert_eq!(json_scalar("42"), serde_json::json!(42));
        assert_eq!(json_scalar("3.140"), serde_json::json!(3.14));
        assert_eq!(json_scalar("true"), serde_json::json!(true));
        assert_eq!(json_scalar("hello.rs"), serde_json::json!("hello.rs"));
    }

    #[test]
    fn render_records_json_includes_meta_and_typed_rows() {
        let rows = vec![vec!["a.rs".to_string(), "0.812".to_string()]];
        let meta = [("returned", serde_json::json!(1))];
        let out = render_records(
            OutputFormat::Json,
            "results",
            &["path", "score"],
            &rows,
            &meta,
        );
        let text = out["content"][0]["text"].as_str().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(text).unwrap();
        assert_eq!(parsed["returned"], 1);
        assert_eq!(parsed["results"][0]["path"], "a.rs");
        assert_eq!(parsed["results"][0]["score"], 0.812);
    }
}
