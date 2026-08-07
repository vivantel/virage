use std::path::Path;

use crate::config::load_config;
use crate::config::resolve::{resolve_embedder, resolve_store};
use crate::output::{Out, OutputFormat};

use super::util::{embedder_dims, open_or_init_db, resolve_config_path, resolve_db_path};
use super::DbPathArg;

#[derive(clap::Args)]
pub struct ReadSkillSummaryArgs {
    /// Skill name to print (e.g. "planner"). Omit to dump all skill files.
    pub skill_name: Option<String>,
}

pub fn cmd_usage(verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    out.info("Usage tracking is handled by the virage-agent-claude plugin.");
    out.dim("See: https://vivantel.dev/virage/docs/telemetry");
    Ok(())
}

pub fn cmd_read_skill_summary(
    skill_name: Option<String>,
    verbose: u8,
    format: OutputFormat,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    // ".agents/skills/virage" is where `virage update` syncs the published
    // @vivantel/virage-skills package for consuming projects; "packages/virage-skills/skills"
    // is this monorepo's own source of truth, used when developing virage itself.
    let skill_dirs = [".agents/skills/virage", "packages/virage-skills/skills"];

    if let Some(name) = skill_name {
        for dir in &skill_dirs {
            let summary_path = Path::new(dir).join(&name).join("SKILL.summary.md");
            if let Ok(text) = std::fs::read_to_string(&summary_path) {
                print!("{text}");
                return Ok(());
            }
            let full_path = Path::new(dir).join(&name).join("SKILL.md");
            if let Ok(text) = std::fs::read_to_string(&full_path) {
                println!("{}", text.lines().take(20).collect::<Vec<_>>().join("\n"));
                return Ok(());
            }
        }
        anyhow::bail!("skill '{name}' not found in {skill_dirs:?}");
    }

    let mut found = false;
    for dir in &skill_dirs {
        let dir_path = Path::new(dir);
        if !dir_path.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(dir_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
        {
            found = true;
            out.section(&entry.path().display().to_string());
            if let Ok(text) = std::fs::read_to_string(entry.path()) {
                for line in text.lines().take(20) {
                    out.info(line);
                }
            }
            println!();
        }
    }
    if !found {
        out.warn(&format!("No skill files found in {:?}.", skill_dirs));
    }
    Ok(())
}

pub fn cmd_viz(verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    out.dim("virage viz: embedding visualisation is deferred post-v2.");
    Ok(())
}

// ─── status ──────────────────────────────────────────────────────────────────

pub async fn cmd_status(
    _args: DbPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let mut all_ok = true;

    // 1. Config
    let (config_ok, cfg_opt) =
        match resolve_config_path(config).and_then(|p| load_config(&p).map(|c| (p, c))) {
            Ok((path, cfg)) => {
                out.info(&format!("  Config      ✓  {path}"));
                (true, Some(cfg))
            }
            Err(e) => {
                out.info(&format!("  Config      ✕  {e}"));
                all_ok = false;
                (false, None)
            }
        };

    // 2. Index DB
    let db_path = resolve_db_path("");
    let index_count = match open_or_init_db(&db_path) {
        Ok(db) => {
            let count = db.get_file_revisions().map(|m| m.len()).unwrap_or(0);
            out.info(&format!("  Index       ✓  {count} files  ({db_path})"));
            Some(count)
        }
        Err(e) => {
            out.info(&format!("  Index       ✕  {e}"));
            all_ok = false;
            None
        }
    };

    // 3. Store (150ms timeout)
    let store_status = if let Some(ref cfg) = cfg_opt {
        let dims = embedder_dims(cfg);
        match resolve_store(&cfg.providers.vector_store, dims) {
            Ok(store) => {
                let ping =
                    tokio::time::timeout(std::time::Duration::from_millis(150), store.initialize())
                        .await;
                match ping {
                    Ok(Ok(_)) => {
                        out.info(&format!(
                            "  Store       ✓  {}",
                            cfg.providers.vector_store.package
                        ));
                        true
                    }
                    Ok(Err(e)) => {
                        out.info(&format!("  Store       ✕  {e}"));
                        all_ok = false;
                        false
                    }
                    Err(_) => {
                        out.info("  Store       ✕  timeout (>150ms)");
                        all_ok = false;
                        false
                    }
                }
            }
            Err(e) => {
                out.info(&format!("  Store       ✕  {e}"));
                all_ok = false;
                false
            }
        }
    } else {
        false
    };

    // 4. Embedder
    let embedder_status = if let Some(ref cfg) = cfg_opt {
        match resolve_embedder(&cfg.providers.embedder) {
            Ok(_) => {
                out.info(&format!(
                    "  Embedder    ✓  {}",
                    cfg.providers.embedder.package
                ));
                true
            }
            Err(e) => {
                out.info(&format!("  Embedder    ✕  {e}"));
                all_ok = false;
                false
            }
        }
    } else {
        false
    };

    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "ok": all_ok,
            "config": config_ok,
            "indexedFiles": index_count,
            "store": store_status,
            "embedder": embedder_status,
        }));
    } else {
        out.section("Status");
        if all_ok {
            out.success("All checks passed.");
        } else {
            out.warn("One or more checks failed — run `virage doctor` for details.");
        }
    }

    if !all_ok {
        std::process::exit(1);
    }
    Ok(())
}

// ─── doctor ──────────────────────────────────────────────────────────────────

pub async fn cmd_doctor(
    _args: DbPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    let mut errors = 0usize;
    let mut warnings = 0usize;

    out.section("Virage Doctor");

    // 1. Config
    match resolve_config_path(config).and_then(|p| load_config(&p).map(|c| (p, c))) {
        Err(e) => {
            out.error_hint(
                &format!("Config not found or invalid: {e}"),
                "Run `virage init` to create a config file.",
            );
            errors += 1;
        }
        Ok((path, cfg)) => {
            out.success(&format!("Config found: {path}"));

            // 2. fileSets not empty
            if cfg.file_sets.is_empty() {
                out.warn("No fileSets configured.");
                out.dim("      Fix: add at least one fileSet to virage.config.json");
                warnings += 1;
            }

            // 3. Embedder resolvable
            match resolve_embedder(&cfg.providers.embedder) {
                Ok(_) => out.success(&format!("Embedder OK: {}", cfg.providers.embedder.package)),
                Err(e) => {
                    out.error_hint(
                        &format!("Embedder unavailable: {e}"),
                        "Check the embedder package name and ensure the model is downloaded.",
                    );
                    errors += 1;
                }
            }

            // 4. Store reachable (150ms timeout)
            let dims = embedder_dims(&cfg);
            match resolve_store(&cfg.providers.vector_store, dims) {
                Err(e) => {
                    let hint = store_hint(&cfg.providers.vector_store.package)
                        .unwrap_or("Check your store configuration.");
                    out.error_hint(&format!("Store not reachable: {e}"), hint);
                    errors += 1;
                }
                Ok(store) => {
                    let ping = tokio::time::timeout(
                        std::time::Duration::from_millis(150),
                        store.initialize(),
                    )
                    .await;
                    match ping {
                        Ok(Ok(_)) => out
                            .success(&format!("Store OK: {}", cfg.providers.vector_store.package)),
                        Ok(Err(e)) => {
                            let hint = store_hint(&cfg.providers.vector_store.package)
                                .unwrap_or("Check your store configuration.");
                            out.error_hint(&format!("Store error: {e}"), hint);
                            errors += 1;
                        }
                        Err(_) => {
                            out.error("Store timed out (>150ms).");
                            out.dim("      Fix: ensure the store is running and reachable.");
                            errors += 1;
                        }
                    }
                }
            }

            // 5. Index DB
            let db_path = resolve_db_path("");
            match open_or_init_db(&db_path) {
                Ok(db) => {
                    let count = db.get_file_revisions().map(|m| m.len()).unwrap_or(0);
                    if count == 0 {
                        out.warn("Index is empty — run `virage index` to build the index.");
                        warnings += 1;
                    } else {
                        out.success(&format!("Index OK: {count} files"));
                    }
                }
                Err(e) => {
                    out.error_hint(
                        &format!("Cannot open state DB: {e}"),
                        "Run `virage index` to initialize the index.",
                    );
                    errors += 1;
                }
            }
        }
    }

    if errors == 0 && warnings == 0 {
        out.success("All checks passed.");
    } else {
        out.info(&format!("\n{errors} error(s) · {warnings} warning(s)"));
    }

    if errors > 0 {
        std::process::exit(1);
    }
    Ok(())
}

fn store_hint(package: &str) -> Option<&'static str> {
    if package.contains("qdrant") {
        Some("Start Qdrant: docker run -p 6333:6333 qdrant/qdrant")
    } else if package.contains("chromadb") {
        Some("Start ChromaDB: docker run -p 8000:8000 chromadb/chroma")
    } else if package.contains("postgres") {
        Some("Check your PostgreSQL connection string in virage.config.json")
    } else {
        None
    }
}
