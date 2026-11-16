use crate::output::{Out, OutputFormat};

use super::util::resolve_db_path;

#[derive(clap::Args)]
pub struct DashboardArgs {
    /// Port to listen on.
    #[arg(long, default_value_t = 3000)]
    pub port: u16,
    /// Path to virage.db.
    #[arg(long, default_value = "")]
    pub db: String,
}

pub fn cmd_dashboard(
    args: DashboardArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let db_path = resolve_db_path(&args.db);
    let mut cmd = std::process::Command::new("npx");
    cmd.args([
        "@vivantel/virage-dashboard",
        "--port",
        &args.port.to_string(),
        "--db",
        &db_path,
    ]);
    if !config.is_empty() {
        cmd.args(["--config", config]);
    }
    out.info(&format!(
        "Starting dashboard on http://localhost:{} ...",
        args.port
    ));
    out.dim("Requires Node.js — install with: npm install -g @vivantel/virage-dashboard");
    let status = cmd.status().map_err(|e| {
        anyhow::anyhow!("Failed to launch dashboard: {e}\nEnsure Node.js is installed.")
    })?;
    if !status.success() {
        anyhow::bail!("dashboard exited with status {status}");
    }
    Ok(())
}
