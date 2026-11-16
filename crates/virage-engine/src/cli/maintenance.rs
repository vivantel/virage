use std::path::PathBuf;

use crate::output::{Out, OutputFormat};

use super::util::resolve_config_path;
use super::ConfigPathArg;

pub fn cmd_migrate(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    let text = std::fs::read_to_string(&config_path)
        .map_err(|e| anyhow::anyhow!("Cannot read {:?}: {e}", config_path))?;
    let mut value: serde_json::Value = serde_json::from_str(&text)?;

    let already_v2 = value.get("providers").is_some() && value.get("fileSets").is_some();
    if already_v2 {
        out.success("Config is already v2 format — nothing to migrate.");
        return Ok(());
    }
    out.info(&format!("Migrating {config_path} ..."));
    if let Some(obj) = value.as_object_mut() {
        obj.insert("version".into(), serde_json::json!("1.0.0"));
    }
    let backup = format!("{config_path}.bak");
    std::fs::copy(&config_path, &backup)?;
    std::fs::write(&config_path, serde_json::to_string_pretty(&value)?)?;
    out.dim(&format!("Backup saved to {backup}"));
    out.success("Migration complete.");
    Ok(())
}

pub fn cmd_install_hooks(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config).unwrap_or_else(|_| "virage.config.json".into());
    let hooks_dir = PathBuf::from(".git/hooks");
    if !hooks_dir.exists() {
        return Err(anyhow::anyhow!(
            "No .git/hooks directory found — are you in a git repo?"
        ));
    }
    for hook in &["post-merge", "post-checkout"] {
        let hook_path = hooks_dir.join(hook);
        let script = format!(
            "#!/bin/sh\nvirage index --config '{}' || true\n",
            config_path
        );
        std::fs::write(&hook_path, script)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&hook_path, std::fs::Permissions::from_mode(0o755))?;
        }
        out.success(&format!("Installed hook: {}", hook_path.display()));
    }
    Ok(())
}

#[derive(clap::Args)]
pub struct PackArgs {
    /// Output file path (default: virage-backup.tar.gz).
    #[arg(short, long, default_value = "virage-backup.tar.gz")]
    pub output: String,
}

pub fn cmd_pack(args: PackArgs, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    use flate2::{write::GzEncoder, Compression};
    let out = Out::new(verbose, format);

    let virage_dir = PathBuf::from(".virage");
    if !virage_dir.exists() {
        return Err(anyhow::anyhow!(
            ".virage/ not found — run `virage index` first"
        ));
    }

    let out_path = PathBuf::from(&args.output);
    let file = std::fs::File::create(&out_path)
        .map_err(|e| anyhow::anyhow!("Cannot create {:?}: {e}", out_path))?;
    let enc = GzEncoder::new(file, Compression::default());
    let mut archive = tar::Builder::new(enc);
    archive.append_dir_all(".virage", &virage_dir)?;
    archive.finish()?;

    let size = std::fs::metadata(&out_path)?.len();
    out.success(&format!(
        "Archive created: {} ({} KB)",
        args.output,
        size / 1024
    ));
    Ok(())
}

pub fn cmd_uninstall(verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    use inquire::Confirm;

    out.section("Virage Uninstall");

    let hooks_dir = PathBuf::from(".git/hooks");
    if hooks_dir.exists() {
        for hook in &["post-merge", "post-checkout"] {
            let p = hooks_dir.join(hook);
            if p.exists()
                && Confirm::new(&format!("Remove git hook {hook}?"))
                    .with_default(false)
                    .with_render_config(super::util::virage_render_config())
                    .prompt()?
            {
                std::fs::remove_file(&p)?;
                out.success(&format!("Removed: {}", p.display()));
            }
        }
    }

    let virage_dir = PathBuf::from(".virage");
    if virage_dir.exists()
        && Confirm::new("Remove .virage/ (index DB)?")
            .with_default(false)
            .with_render_config(super::util::virage_render_config())
            .prompt()?
    {
        std::fs::remove_dir_all(&virage_dir)?;
        out.success("Removed: .virage/");
    }

    let config = PathBuf::from("virage.config.json");
    if config.exists()
        && Confirm::new("Remove virage.config.json?")
            .with_default(false)
            .with_render_config(super::util::virage_render_config())
            .prompt()?
    {
        std::fs::remove_file(&config)?;
        out.success("Removed: virage.config.json");
    }

    out.success("Uninstall complete.");
    Ok(())
}
