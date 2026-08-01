use crate::config::load_config;
use crate::config::resolve::resolve_store;
use crate::output::{Out, OutputFormat};

use super::util::{
    detect_file_types, embedder_dims, open_or_init_db, resolve_config_path, resolve_db_path,
    spinner, FILE_TYPE_META,
};
use super::ConfigPathArg;

pub async fn cmd_validate(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let t0 = std::time::Instant::now();
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    out.section("Validate");
    out.dim(&format!("Config: {config_path}"));

    // A1 — spinner around load_config()
    let pb = spinner("Loading config...");
    let cfg = load_config(&config_path)?;
    pb.finish_and_clear();

    if cfg.file_sets.is_empty() {
        return Err(anyhow::anyhow!("fileSets must have at least one entry"));
    }

    let mut warnings = 0usize;
    let mut warning_msgs: Vec<String> = Vec::new();
    let mut file_set_counts: Vec<serde_json::Value> = Vec::new();
    let cwd = std::env::current_dir()?;

    // A2 — spinner around glob file scan loop (E1: count matches per fileSet)
    let pb = spinner("Scanning file patterns...");
    for fs in &cfg.file_sets {
        if fs.chunkers.is_empty() {
            out.warn(&format!("fileSet {:?}: chunkers is empty", fs.name));
            warnings += 1;
        }
        if fs.include.is_empty() {
            out.warn(&format!(
                "fileSet {:?}: no include patterns — will match nothing",
                fs.name
            ));
            warnings += 1;
            continue;
        }

        // E1: build a globset and count matches on disk
        let mut builder = globset::GlobSetBuilder::new();
        let mut pattern_errors = 0usize;
        for pat in &fs.include {
            match globset::Glob::new(pat) {
                Ok(g) => {
                    out.verbose(&format!("fileSet {:?}: pattern {:?} OK", fs.name, pat));
                    builder.add(g);
                }
                Err(e) => {
                    out.warn(&format!(
                        "fileSet {:?}: invalid pattern {:?}: {e}",
                        fs.name, pat
                    ));
                    warnings += 1;
                    pattern_errors += 1;
                }
            }
        }
        if pattern_errors == fs.include.len() {
            continue;
        }
        let globset = builder.build().unwrap_or_default();
        let match_count = walkdir::WalkDir::new(&cwd)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter(|e| {
                e.path()
                    .strip_prefix(&cwd)
                    .map(|rel| globset.is_match(rel))
                    .unwrap_or(false)
            })
            .count();
        out.info(&format!(
            "  fileSet {:?}: {} file(s) matched",
            fs.name, match_count
        ));
        file_set_counts.push(serde_json::json!({
            "name": fs.name,
            "matchCount": match_count,
        }));
        if match_count == 0 {
            let msg = format!("fileSet {:?}: no files matched include patterns", fs.name);
            out.warn(&msg);
            warning_msgs.push(msg);
            warnings += 1;
        }
    }
    pb.finish_and_clear();

    // E3: file type coverage — detect types and check gaps
    let detected = detect_file_types(&cwd);
    let all_includes: Vec<&str> = cfg
        .file_sets
        .iter()
        .flat_map(|fs| fs.include.iter().map(String::as_str))
        .collect();
    for (type_name, count) in &detected {
        let type_patterns = FILE_TYPE_META
            .iter()
            .find(|(k, _, _, _)| k == type_name)
            .map(|(_, _, pats, _)| *pats)
            .unwrap_or(&[]);
        let covered = type_patterns.iter().any(|tp| {
            all_includes
                .iter()
                .any(|inc| inc == tp || inc.contains(tp.trim_start_matches("**/")))
        });
        if !covered {
            out.warn(&format!(
                "File type {:?} ({count} file(s)) not covered by any fileSet include pattern",
                type_name
            ));
            warnings += 1;
        }
    }

    out.info(&format!("\nEmbedder : {}", cfg.providers.embedder.package));
    out.info(&format!(
        "Store    : {}",
        cfg.providers.vector_store.package
    ));
    if let Some(src) = &cfg.providers.source {
        out.info(&format!("Source   : {}", src.package));
    }
    out.info(&format!("FileSets : {}", cfg.file_sets.len()));

    // A3/E2 — spinner around store.initialize(); warn on error, don't abort
    let pb = spinner("Connecting to vector store...");
    let dims = embedder_dims(&cfg);
    match resolve_store(&cfg.providers.vector_store, dims) {
        Ok(store) => match store.initialize().await {
            Ok(_) => out.verbose("Vector store reachable."),
            Err(e) => {
                out.warn(&format!("Vector store not reachable: {e}"));
                warnings += 1;
            }
        },
        Err(e) => {
            out.warn(&format!("Could not resolve vector store: {e}"));
            warnings += 1;
        }
    }
    pb.finish_and_clear();

    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "valid": warnings == 0,
            "warnings": warning_msgs,
            "fileSets": file_set_counts,
        }));
    } else if warnings > 0 {
        out.warn(&format!("Config loaded with {warnings} warning(s)."));
    } else {
        out.success("Config is valid.");
    }
    let db_path = resolve_db_path("");
    if let Ok(db) = open_or_init_db(&db_path) {
        let _ = db.record_cli_command("validate", t0.elapsed().as_millis() as u64, true);
    }
    Ok(())
}

pub async fn cmd_check(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let t0 = std::time::Instant::now();
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    let cfg = load_config(&config_path)?;
    let dims = embedder_dims(&cfg);

    let pb = spinner("Connecting to vector store...");
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    store.initialize().await?;
    pb.finish_and_clear();

    let state = store.current_state().await?;
    out.section("Index Check");
    out.info(&format!(
        "Vector store  : {}",
        cfg.providers.vector_store.package
    ));
    out.info(&format!("Indexed files : {}", state.len()));
    out.info(&format!("Dimensions    : {dims}"));

    // F2: compare stored metadata against current config
    let mut ok = true;
    match store.read_meta().await? {
        None => {
            out.warn("No index metadata found — run `virage index` to build the index.");
        }
        Some(meta) => {
            let config_model = &cfg.providers.embedder.package;
            if &meta.model != config_model {
                out.error(&format!(
                    "Embedder mismatch: index uses {:?}, config has {:?}",
                    meta.model, config_model
                ));
                ok = false;
            }
            if meta.dimensions != dims {
                out.error(&format!(
                    "Dimension mismatch: index has {}, config has {dims}",
                    meta.dimensions
                ));
                ok = false;
            }
        }
    }

    let db_path = resolve_db_path("");
    if let Ok(db) = open_or_init_db(&db_path) {
        let _ = db.record_cli_command("check", t0.elapsed().as_millis() as u64, ok);
    }

    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "ok": ok,
            "embedder": cfg.providers.embedder.package,
            "dimensions": dims,
        }));
        if !ok {
            std::process::exit(1);
        }
        Ok(())
    } else if ok {
        out.success("Status: OK");
        Ok(())
    } else {
        out.error("Index metadata does not match config — re-run `virage index`.");
        std::process::exit(1);
    }
}
