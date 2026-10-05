//! `virage query-serve` — a warm, session-scoped query daemon.
//!
//! Not a user-facing command (hidden from `--help`); spawned and owned by MCP server
//! implementations (e.g. `virage-agent-claude`) that would otherwise re-pay the
//! embedder's ~30s cold start on every `virage query` subprocess invocation.
//!
//! Protocol: resolve the embedder/store/reranker once, then read newline-delimited
//! JSON requests from stdin (each deserializing as [`QueryArgs`]) and write one
//! newline-delimited JSON response per request to stdout — either the same JSON row
//! array `virage query --format json` produces, or `{"error": "..."}` on failure. A
//! malformed request line gets a loud `{"error": "..."}` reply, never a silent skip —
//! the daemon protocol should fail as loudly as the CLI's own flag parsing does.
//! Exits cleanly on stdin EOF (the parent process closing the pipe is the intended
//! shutdown signal; there is no separate idle timeout at this scope — see
//! docs/decisions/IR-049 in virage-ee for the still-open machine-wide daemon that
//! would need one).

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::config::load_config;

use super::query::{resolve_engine, run_search, QueryArgs};
use super::util::resolve_config_path;

#[derive(clap::Args)]
pub struct QueryServeArgs {
    #[arg(long, default_value = "")]
    pub config: String,
}

pub async fn cmd_query_serve(args: &QueryServeArgs) -> anyhow::Result<()> {
    let config_path = resolve_config_path(&args.config)?;
    let cfg = load_config(&config_path)?;

    eprintln!("[virage] query-serve ready, resolving engine...");
    let engine = resolve_engine(&cfg).await?;
    eprintln!("[virage] query-serve engine warm, awaiting requests.");

    let mut reader = BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();
    let mut line = String::new();

    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            break; // stdin closed — parent process is gone, shut down.
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<QueryArgs>(trimmed) {
            Ok(query_args) => match run_search(&query_args, &cfg, &engine).await {
                Ok(rows) => serde_json::Value::Array(rows),
                Err(e) => serde_json::json!({"error": e.to_string()}),
            },
            Err(e) => serde_json::json!({"error": format!("invalid request: {e}")}),
        };

        let mut s = serde_json::to_string(&response)?;
        s.push('\n');
        stdout.write_all(s.as_bytes()).await?;
        stdout.flush().await?;
    }
    Ok(())
}
