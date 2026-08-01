use std::path::{Path, PathBuf};

use crate::output::{Out, OutputFormat};

use super::util::{open_or_init_db, resolve_db_path, virage_render_config};

#[derive(clap::Args)]
pub struct TelemetryArgs {
    #[command(subcommand)]
    pub command: TelemetryCommand,
}

#[derive(clap::Subcommand)]
pub enum TelemetryCommand {
    /// Show telemetry status and buffer info.
    Status,
    /// Enable telemetry collection.
    On,
    /// Disable telemetry collection.
    Off,
    /// Preview the pending telemetry payload.
    Preview,
    /// Flush buffered telemetry events.
    Flush,
    /// Interactive telemetry configuration wizard.
    Init,
}

fn virage_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("virage")
}

pub fn cmd_telemetry(args: TelemetryArgs, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let config_dir = virage_config_dir();
    let flag_file = config_dir.join("telemetry.enabled");
    let telemetry_cfg = config_dir.join("telemetry.json");
    match args.command {
        TelemetryCommand::Status => {
            let enabled = flag_file.exists();
            if enabled {
                out.success("Telemetry: enabled");
                if let Ok(raw) = std::fs::read_to_string(&telemetry_cfg) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                        if let Some(ep) = v.get("endpoint").and_then(|e| e.as_str()) {
                            out.dim(&format!("  Endpoint : {ep}"));
                        }
                        if let Some(tier2) = v.get("tier2").and_then(|t| t.as_bool()) {
                            out.dim(&format!("  Tier-2   : {tier2}"));
                        }
                    }
                }
            } else {
                out.warn("Telemetry: disabled");
            }
        }
        TelemetryCommand::On => {
            std::fs::create_dir_all(&config_dir)?;
            std::fs::write(&flag_file, "")?;
            out.success("Telemetry enabled.");
        }
        TelemetryCommand::Off => {
            let _ = std::fs::remove_file(&flag_file);
            out.success("Telemetry disabled.");
        }
        TelemetryCommand::Preview => {
            let db_path = resolve_db_path("");
            let db = open_or_init_db(&db_path)?;
            let rows = db
                .get_pending_telemetry()
                .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;
            if rows.is_empty() {
                out.dim("No pending telemetry events.");
            } else {
                out.section("Pending Telemetry");
                for r in &rows {
                    out.info(&format!(
                        "  [{}] {} {}ms {}",
                        r.id,
                        r.command,
                        r.duration_ms,
                        if r.success { "ok" } else { "err" }
                    ));
                }
            }
        }
        TelemetryCommand::Flush => {
            let db_path = resolve_db_path("");
            let db = open_or_init_db(&db_path)?;
            let rows = db
                .get_pending_telemetry()
                .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;
            if rows.is_empty() {
                out.dim("No events to flush.");
            } else {
                let telemetry_endpoint = "https://telemetry.vivantel.com/v1/cli";
                let payload: Vec<serde_json::Value> = rows
                    .iter()
                    .map(|r| {
                        serde_json::json!({
                            "command": r.command,
                            "durationMs": r.duration_ms,
                            "success": r.success,
                            "recordedAt": r.recorded_at,
                        })
                    })
                    .collect();
                let body = serde_json::to_string(&serde_json::json!({ "events": payload }))?;
                let result = ureq::post(telemetry_endpoint)
                    .set("Content-Type", "application/json")
                    .send_bytes(body.as_bytes());
                match result {
                    Ok(_) => {
                        db.clear_telemetry()
                            .map_err(|e| anyhow::anyhow!("DB clear error: {e}"))?;
                        out.success(&format!("Flushed {} event(s).", rows.len()));
                    }
                    Err(e) => {
                        out.warn(&format!("Flush failed (events retained): {e}"));
                    }
                }
            }
        }
        TelemetryCommand::Init => {
            cmd_telemetry_init(&out, &config_dir, &flag_file, &telemetry_cfg)?;
        }
    }
    Ok(())
}

fn cmd_telemetry_init(
    out: &Out,
    config_dir: &Path,
    flag_file: &Path,
    telemetry_cfg: &Path,
) -> anyhow::Result<()> {
    use inquire::{Confirm, InquireError, Text};

    out.section("Telemetry Setup");

    let mut endpoint = String::from("https://telemetry.vivantel.com");
    let mut api_key = String::new();
    let mut tier2 = false;
    let mut sampling_rate = 5u8;
    let mut step = 0usize;

    loop {
        match step {
            // Step 1: Endpoint type
            0 => {
                let choices = ["Vivantel hosted (default)", "Custom endpoint"];
                match super::util::select_step("Telemetry endpoint", &choices, 0)? {
                    None => {
                        out.info("Cancelled.");
                        return Ok(());
                    }
                    Some(1) => step = 1,
                    Some(_) => {
                        endpoint = "https://telemetry.vivantel.com".into();
                        step = 2;
                    }
                }
            }
            // Step 2: Custom endpoint URL + API key
            1 => {
                let url = match Text::new("Endpoint URL")
                    .with_default(&endpoint)
                    .with_render_config(virage_render_config())
                    .prompt()
                {
                    Ok(v) => v,
                    Err(InquireError::OperationCanceled) => {
                        step = 0;
                        continue;
                    }
                    Err(e) => return Err(e.into()),
                };
                let key = match Text::new("API key (leave blank if not required)")
                    .with_default("")
                    .with_render_config(virage_render_config())
                    .prompt()
                {
                    Ok(v) => v,
                    Err(InquireError::OperationCanceled) => {
                        step = 0;
                        continue;
                    }
                    Err(e) => return Err(e.into()),
                };

                let use_it = match Confirm::new(&format!("Use endpoint {url}?"))
                    .with_default(true)
                    .with_render_config(virage_render_config())
                    .prompt()
                {
                    Ok(v) => v,
                    Err(InquireError::OperationCanceled) => false,
                    Err(e) => return Err(e.into()),
                };
                if !use_it {
                    step = 0;
                    continue;
                }
                endpoint = url;
                api_key = key;
                step = 2;
            }
            // Step 3: Tier-2 usage telemetry
            2 => {
                out.dim("Tier-2 telemetry shares anonymised query patterns to improve relevance.");
                let choices = ["Enable tier-2", "Skip tier-2"];
                match super::util::select_step("Enable tier-2 usage telemetry?", &choices, 1)? {
                    None => {
                        step = if api_key.is_empty() && endpoint.contains("vivantel") {
                            0
                        } else {
                            1
                        };
                        continue;
                    }
                    Some(0) => {
                        tier2 = true;
                        step = 3;
                    }
                    Some(_) => {
                        tier2 = false;
                        step = 4;
                    }
                }
            }
            // Step 4: Sampling rate (only if tier-2 enabled)
            3 => {
                let choices = ["1% (minimal)", "5% (default)", "10%", "100% (full)"];
                match super::util::select_step("Sampling rate", &choices, 1)? {
                    None => {
                        step = 2;
                        continue;
                    }
                    Some(0) => sampling_rate = 1,
                    Some(2) => sampling_rate = 10,
                    Some(3) => sampling_rate = 100,
                    Some(_) => sampling_rate = 5,
                }
                step = 4;
            }
            // Step 5: Confirm
            4 => {
                out.section("Summary");
                out.info(&format!("  Endpoint    : {endpoint}"));
                if !api_key.is_empty() {
                    out.info("  API key     : ****");
                }
                out.info(&format!("  Tier-2      : {tier2}"));
                if tier2 {
                    out.info(&format!("  Sampling    : {sampling_rate}%"));
                }
                println!();

                let choices = ["Save and enable", "Cancel"];
                match super::util::select_step("Confirm", &choices, 0)? {
                    None => {
                        step = if tier2 { 3 } else { 2 };
                        continue;
                    }
                    Some(1) => {
                        out.info("Cancelled.");
                        return Ok(());
                    }
                    Some(_) => {}
                }
                break;
            }
            _ => break,
        }
    }

    // Write config
    std::fs::create_dir_all(config_dir)?;
    let mut cfg = serde_json::json!({
        "endpoint": endpoint,
        "tier2": tier2,
    });
    if !api_key.is_empty() {
        cfg["apiKey"] = serde_json::Value::String(api_key);
    }
    if tier2 {
        cfg["samplingRate"] = serde_json::Value::Number(sampling_rate.into());
    }
    std::fs::write(telemetry_cfg, serde_json::to_string_pretty(&cfg)?)?;
    std::fs::write(flag_file, "")?;
    out.success("Telemetry configured and enabled.");
    Ok(())
}
