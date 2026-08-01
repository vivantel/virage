use crate::output::{Out, OutputFormat};

#[derive(clap::Args)]
pub struct PluginArgs {
    #[command(subcommand)]
    pub command: PluginCommand,
}

#[derive(clap::Subcommand)]
pub enum PluginCommand {
    /// Load and smoke-test a WASM plugin.
    Test {
        /// Path to the .wasm file.
        path: String,
    },
}

pub fn cmd_plugin(args: PluginArgs, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    match args.command {
        PluginCommand::Test { path } => cmd_plugin_test(&path, verbose, format),
    }
}

fn cmd_plugin_test(path: &str, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    #[cfg(feature = "wasm-host")]
    return cmd_plugin_test_wasm(path, verbose, format);
    #[cfg(not(feature = "wasm-host"))]
    {
        let _ = path;
        let out = Out::new(verbose, format);
        out.warn("WASM host not available — rebuild with --features wasm-host.");
        Ok(())
    }
}

#[cfg(feature = "wasm-host")]
fn cmd_plugin_test_wasm(path: &str, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    use crate::plugins::wasm::chunker::WasmChunkerAdapter;
    use crate::plugins::wasm::{FileInfo, WasmPluginHost, WasmRegistry};
    let out = Out::new(verbose, format);

    let wasm_path = std::path::Path::new(path);
    if !wasm_path.exists() {
        return Err(anyhow::anyhow!("File not found: {path}"));
    }

    out.info(&format!("Loading plugin: {path}"));
    let host = WasmPluginHost::new()?;
    let registry = WasmRegistry::new(host);
    let adapter = WasmChunkerAdapter::from_path(&registry, wasm_path, "{}")?;

    out.dim("  init + patterns...");
    let patterns = adapter.init_and_patterns()?;
    out.verbose(&format!("  Patterns: {patterns:?}"));

    out.dim("  parse + chunk smoke test...");
    let info = FileInfo {
        path: "smoke-test.txt".to_string(),
        hash: "smoke".to_string(),
        size: 13,
        modified_ms: 0,
    };
    let doc = adapter.parse(&info, b"Hello, world.")?;
    let chunks = adapter.chunk(&doc, &info, "HEAD")?;
    out.success(&format!("Plugin test PASSED — {} chunk(s).", chunks.len()));
    Ok(())
}
