use crate::output::{Out, OutputFormat};

use super::util::{open_or_init_db, resolve_db_path};
use super::DbPathArg;

#[derive(clap::Args)]
pub struct ChunksArgs {
    #[command(subcommand)]
    pub command: ChunksCommand,
}

#[derive(clap::Subcommand)]
pub enum ChunksCommand {
    /// Dump chunk data from the state DB.
    Report(DbPathArg),
}

pub fn cmd_report(args: DbPathArg, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let db_path = resolve_db_path(&args.db);
    let db = open_or_init_db(&db_path)?;

    let revisions = db
        .get_file_revisions()
        .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;
    let pending_embed = db
        .pending_embed_count()
        .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;
    let pending_upload = db
        .pending_upload_count()
        .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;

    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "dbPath": db_path,
            "indexedFiles": revisions.len(),
            "pendingEmbed": pending_embed,
            "pendingUpload": pending_upload,
        }));
    } else {
        out.section("Virage Report");
        out.info(&format!("DB path          : {db_path}"));
        out.info(&format!("Indexed files    : {}", revisions.len()));
        out.info(&format!("Pending embed    : {pending_embed}"));
        out.info(&format!("Pending upload   : {pending_upload}"));
    }
    Ok(())
}

pub fn cmd_chunks_report(args: DbPathArg, verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let db_path = resolve_db_path(&args.db);
    let db = open_or_init_db(&db_path)?;
    let revisions = db
        .get_file_revisions()
        .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;

    if revisions.is_empty() {
        out.warn(&format!("No indexed files found in {db_path}."));
        return Ok(());
    }

    out.section(&format!("Chunks Report ({} files)", revisions.len()));
    let mut files: Vec<_> = revisions.iter().collect();
    files.sort_by_key(|(k, _)| k.as_str());
    for (file, rev) in &files {
        out.dim(&format!("  {}  [{}]", file, &rev[..rev.len().min(8)]));
    }
    Ok(())
}
