use crate::config::resolve::{resolve_embedder, resolve_store};
use crate::config::{default_db_path, load_config};

use super::util::{embedder_dims, resolve_config_path};

#[derive(clap::Args)]
pub struct ServeArgs {
    /// Transport to use: stdio (default) or http.
    /// HTTP transport requires a serve extension; without one virage exits with an error.
    #[arg(long, default_value = "stdio")]
    pub transport: String,

    /// Bearer token hint passed to a serve extension for auth configuration.
    /// Ignored when no serve extension is installed.
    #[arg(long)]
    pub auth_token: Option<String>,
}

pub async fn cmd_serve(args: &ServeArgs, config: &str) -> anyhow::Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    if args.transport == "http" {
        anyhow::bail!(
            "HTTP transport requires a serve extension to be installed. \
             Running an unauthenticated HTTP MCP server is not safe; install a serve \
             extension or use --transport stdio."
        );
    }

    if args.auth_token.is_some() {
        tracing::warn!("--auth-token provided but no serve extension is installed; token ignored.");
    }

    let config_path = resolve_config_path(config)?;
    let cfg = load_config(&config_path)?;
    let dims = embedder_dims(&cfg);
    let db_path = default_db_path();

    let embedder = resolve_embedder(&cfg.providers.embedder)?;
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;

    let mut reader = BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();
    let mut line = String::new();

    eprintln!(
        "[virage] MCP stdio server v{} ready.",
        env!("CARGO_PKG_VERSION")
    );

    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let request: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        // JSON-RPC 2.0: notifications (no "id") don't get responses.
        let Some(id) = request.get("id").cloned() else {
            continue;
        };
        let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let result: Result<serde_json::Value, serde_json::Value> = match method {
            "initialize" => Ok(serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "virage", "version": env!("CARGO_PKG_VERSION") }
            })),
            "tools/list" => Ok(crate::mcp::tools_list()),
            "tools/call" => {
                let name = request
                    .pointer("/params/name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let call_args = request
                    .pointer("/params/arguments")
                    .cloned()
                    .unwrap_or_default();
                crate::mcp::tool_call(&name, &call_args, &embedder, &store, &db_path, None).await
            }
            _ => Err(serde_json::json!({"code": -32601, "message": "Method not found"})),
        };
        let response = match result {
            Ok(r) => serde_json::json!({"jsonrpc":"2.0","id":id,"result":r}),
            Err(e) => serde_json::json!({"jsonrpc":"2.0","id":id,"error":e}),
        };
        let mut s = serde_json::to_string(&response)?;
        s.push('\n');
        stdout.write_all(s.as_bytes()).await?;
        stdout.flush().await?;
    }
    Ok(())
}
