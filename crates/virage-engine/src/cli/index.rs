use std::collections::HashMap;
use std::sync::Arc;

use crate::config::load_config;
use crate::config::resolve::{resolve_embedder, resolve_file_set_groups, resolve_store};
use crate::output::{Out, OutputFormat};
use crate::pipeline::{
    coordinator::run_pipeline, list_current_state, ConcurrencyStrategy, PipelineConfig,
    ProgressCounters, RamSampling,
};
use crate::progress::{finish_stage, Progress};

use super::util::{embedder_dims, open_or_init_db, resolve_config_path, resolve_db_path};

/// Resolve the worker ceiling and concurrency strategy for a `run_pipeline` call (ADR-057).
///
/// `--workers N` (or `pipeline.concurrency` in config) sets the *ceiling* — the max worker count
/// either strategy scales toward. Which strategy is active is decided in this order:
///
/// 1. `cfg_strategy` (`pipeline.concurrencyStrategy` in config: `"fixed"` or `"ramSampling"`) —
///    an explicit choice always wins, even if `--workers`/`concurrency` was also set (a fixed
///    count still becomes `RamSampling`'s ceiling if `"ramSampling"` is explicitly requested
///    alongside it, rather than being treated as a pin). Unrecognized values fall through to (2).
/// 2. No explicit strategy: `default_dynamic` (per-call-site — see callers) decides, but only
///    when no explicit worker count was given either; an explicit `--workers`/`concurrency`
///    with no `concurrencyStrategy` still pins `FixedWorkers` exactly as pre-ADR-057, preserving
///    that flag's original "pin this many, don't scale" meaning.
pub(crate) fn resolve_concurrency(
    args_workers: Option<usize>,
    cfg_workers: Option<usize>,
    cfg_strategy: Option<&str>,
    default_ceiling: usize,
    default_dynamic: bool,
) -> (usize, Option<Arc<dyn ConcurrencyStrategy>>) {
    let explicit_workers = args_workers.or(cfg_workers);
    let ceiling = explicit_workers.unwrap_or(default_ceiling);

    let use_ram_sampling = match cfg_strategy {
        Some("ramSampling") => true,
        Some("fixed") => false,
        _ => default_dynamic && explicit_workers.is_none(),
    };

    let strategy: Option<Arc<dyn ConcurrencyStrategy>> = if use_ram_sampling {
        Some(Arc::new(RamSampling::new(ceiling)))
    } else {
        None
    };
    (ceiling, strategy)
}

/// `available_parallelism()`-or-4 fallback ceiling, shared by every call site below that used
/// this exact fallback pre-ADR-057 (all but the watch-loop's periodic reindex, which kept its
/// own pre-existing flat-4 default instead — see that call site).
pub(crate) fn cores_or_four() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

#[derive(clap::Args)]
pub struct IndexArgs {
    /// Re-index all files even if unchanged.
    #[arg(long)]
    pub force: bool,
    /// Show what would change without writing anything.
    #[arg(long)]
    pub dry_run: bool,
    /// Number of parallel worker tasks.
    #[arg(long)]
    pub workers: Option<usize>,
    /// Path to virage.db.
    #[arg(long, default_value = "")]
    pub db: String,
    /// Re-run pipeline on file changes (stub — not yet implemented).
    #[arg(long)]
    pub watch: bool,
    /// Index locally without uploading to the vector store.
    #[arg(long)]
    pub no_upload: bool,
}

pub async fn cmd_index(
    args: IndexArgs,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let t0 = std::time::Instant::now();
    let out = Out::new(verbose, format);
    let config_path = resolve_config_path(config)?;
    let cfg = load_config(&config_path)?;
    let db_path = resolve_db_path(&args.db);
    let cwd = std::env::current_dir()?;
    let dims = embedder_dims(&cfg);

    let force = args.force || cfg.pipeline.as_ref().and_then(|p| p.force).unwrap_or(false);
    let dry_run = args.dry_run
        || cfg
            .pipeline
            .as_ref()
            .and_then(|p| p.dry_run)
            .unwrap_or(false);

    // ── Resolve providers ─────────────────────────────────────────────────────
    let prog = Progress::new(format);

    let t_stage = std::time::Instant::now();
    let stage = prog.stage("Loading embedder...");
    let embedder = resolve_embedder(&cfg.providers.embedder)?;
    finish_stage(stage);
    out.verbose(&format!(
        "embedder: {}  ({}ms)",
        cfg.providers.embedder.package,
        t_stage.elapsed().as_millis()
    ));

    let t_stage = std::time::Instant::now();
    let stage = prog.stage("Connecting to vector store...");
    let store = resolve_store(&cfg.providers.vector_store, dims)?;
    finish_stage(stage);
    out.verbose(&format!(
        "store: {}  ({}ms)",
        cfg.providers.vector_store.package,
        t_stage.elapsed().as_millis()
    ));

    let t_stage = std::time::Instant::now();
    let stage = prog.stage("Opening state DB...");
    let db = open_or_init_db(&db_path)?;
    let db_revisions = db
        .get_file_revisions()
        .map_err(|e| anyhow::anyhow!("DB read error: {e}"))?;
    let known_revisions: HashMap<String, String> = if force {
        HashMap::new()
    } else if db_revisions.is_empty() {
        // An empty state DB can't distinguish "genuinely first-ever index" from "ephemeral
        // environment (fresh checkout, CI runner) that reset between runs while the remote
        // store did not" -- an empty map here would silently disable deletion detection for
        // the latter case forever (run_pipeline's `to_delete` is known_revisions.keys() minus
        // what's on disk now; empty in means empty out), even though the store itself already
        // knows exactly what it holds. Reconcile from the store directly: this is an O(corpus
        // size) scan, acceptable as a one-time cold-start cost, but deliberately not the
        // steady-state path (see the local-db fast path below) -- guaranteed consistency over
        // eventual consistency for this specific decision, not a general policy of always
        // trusting the store over the local buffer.
        store.initialize().await?;
        let reconciled = store.current_state().await?;
        out.verbose(&format!(
            "state DB is empty — reconciled {} known revision(s) from the vector store",
            reconciled.len()
        ));
        reconciled
    } else {
        db_revisions
    };
    finish_stage(stage);
    out.verbose(&format!("state DB: {}ms", t_stage.elapsed().as_millis()));

    let t_stage = std::time::Instant::now();
    let stage = prog.stage("Resolving fileSets...");
    let groups = resolve_file_set_groups(&cfg, &cwd)?;
    finish_stage(stage);
    out.verbose(&format!(
        "fileSets: {}  ({}ms)",
        groups.len(),
        t_stage.elapsed().as_millis()
    ));

    if args.watch {
        use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
        use std::sync::mpsc::TryRecvError;

        // Run initial full index before entering watch loop.
        {
            let progress = ProgressCounters::new();
            let (workers, concurrency_strategy) = resolve_concurrency(
                args.workers,
                cfg.pipeline.as_ref().and_then(|p| p.concurrency),
                cfg.pipeline
                    .as_ref()
                    .and_then(|p| p.concurrency_strategy.as_deref()),
                cores_or_four(),
                true,
            );
            let pipeline_cfg = PipelineConfig {
                workers,
                concurrency_strategy,
                upload_batch_size: cfg
                    .pipeline
                    .as_ref()
                    .and_then(|p| p.min_upload_batch_size)
                    .unwrap_or(64),
                max_tokens: 512,
                progress: Some(progress.clone()),
                skip_upload: args.no_upload,
                label_rules: cfg
                    .label_rules
                    .iter()
                    .map(|r| crate::pipeline::LabelRule {
                        pattern: r.pattern.clone(),
                        add: r.add.clone(),
                    })
                    .collect(),
                ..Default::default()
            };
            let file_bar = prog.file_bar(0, "Indexing");
            let chunk_bar = prog.stage("0 chunks embedded");
            let pt = {
                let p = progress.clone();
                let fb = file_bar.clone();
                let cb = chunk_bar.clone();
                tokio::spawn(async move {
                    loop {
                        let (total, _, done, chunks) = p.snapshot();
                        if total > 0 {
                            fb.set_length(total as u64);
                            fb.set_position(done as u64);
                        }
                        cb.set_message(format!("{chunks} chunks embedded"));
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                })
            };
            let _ = run_pipeline(
                &pipeline_cfg,
                groups.clone(),
                embedder.clone(),
                store.clone(),
                known_revisions.clone(),
            )
            .await;
            pt.abort();
            file_bar.finish_and_clear();
            chunk_bar.finish_and_clear();
        }

        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = new_debouncer(std::time::Duration::from_millis(300), tx)
            .map_err(|e| anyhow::anyhow!("watcher error: {e}"))?;
        debouncer
            .watcher()
            .watch(&cwd, RecursiveMode::Recursive)
            .map_err(|e| anyhow::anyhow!("watcher error: {e}"))?;

        let indexed = db.get_file_revisions().map(|m| m.len()).unwrap_or(0);
        out.info(&format!(
            "Watching — {indexed} files indexed · Ctrl+C to stop"
        ));

        loop {
            match rx.try_recv() {
                Ok(Ok(events)) => {
                    let changed: Vec<_> = events
                        .iter()
                        .filter(|e| !e.path.to_string_lossy().contains(".virage"))
                        .collect();
                    if changed.is_empty() {
                        continue;
                    }

                    let now = {
                        let d = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default();
                        let secs = d.as_secs();
                        format!(
                            "{:02}:{:02}:{:02}",
                            (secs / 3600) % 24,
                            (secs / 60) % 60,
                            secs % 60
                        )
                    };
                    eprintln!("[{now}] {} file(s) changed — re-indexing...", changed.len());

                    let t_watch = std::time::Instant::now();
                    let known = db.get_file_revisions().unwrap_or_default();
                    let progress = ProgressCounters::new();
                    // Pre-ADR-057, this call site's default was a flat `4`, not
                    // `available_parallelism()` like the other two call sites — an incremental
                    // watch-triggered reindex is a lower-stakes background operation than a full
                    // `virage index` run, and this box's original tuning kept it capped
                    // regardless of core count. Preserved deliberately (review fix — unifying
                    // all three call sites onto `cores_or_four()` silently changed this one).
                    let (workers, concurrency_strategy) = resolve_concurrency(
                        args.workers,
                        cfg.pipeline.as_ref().and_then(|p| p.concurrency),
                        cfg.pipeline
                            .as_ref()
                            .and_then(|p| p.concurrency_strategy.as_deref()),
                        4,
                        true,
                    );
                    let pipeline_cfg = PipelineConfig {
                        workers,
                        concurrency_strategy,
                        upload_batch_size: cfg
                            .pipeline
                            .as_ref()
                            .and_then(|p| p.min_upload_batch_size)
                            .unwrap_or(64),
                        max_tokens: 512,
                        progress: Some(progress.clone()),
                        skip_upload: args.no_upload,
                        label_rules: cfg
                            .label_rules
                            .iter()
                            .map(|r| crate::pipeline::LabelRule {
                                pattern: r.pattern.clone(),
                                add: r.add.clone(),
                            })
                            .collect(),
                        ..Default::default()
                    };
                    match run_pipeline(
                        &pipeline_cfg,
                        groups.clone(),
                        embedder.clone(),
                        store.clone(),
                        known,
                    )
                    .await
                    {
                        Ok(stats) => {
                            let ms = t_watch.elapsed().as_millis();
                            let count = db.get_file_revisions().map(|m| m.len()).unwrap_or(0);
                            eprintln!(
                                "  ✓ Done — {} file(s) · {} chunks · {ms}ms · {count} total",
                                stats.files_processed, stats.chunks_upserted
                            );
                        }
                        Err(e) => {
                            eprintln!("  ⚠ Re-index failed — {e}");
                            eprintln!("      Watching continues. Fix the file to re-trigger.");
                        }
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("⚠ Watch error: {e:?}");
                }
                Err(TryRecvError::Empty) => {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
                Err(TryRecvError::Disconnected) => break,
            }
        }
        eprintln!("Stopped watching.");
        std::process::exit(130);
    }

    // ── Dry-run mode ──────────────────────────────────────────────────────────
    if dry_run {
        out.section("Dry Run");
        let current = list_current_state(&groups).await?;
        let to_process = current
            .iter()
            .filter(|(key, _path, rev)| {
                known_revisions.get(key).map(String::as_str).unwrap_or("") != rev.as_str()
            })
            .count();
        let current_keys: std::collections::HashSet<&str> =
            current.iter().map(|(k, _, _)| k.as_str()).collect();
        let to_delete = known_revisions
            .keys()
            .filter(|k| !current_keys.contains(k.as_str()))
            .count();
        out.info(&format!("  Files to index  : {to_process}"));
        out.info(&format!(
            "  Files unchanged : {}",
            current.len().saturating_sub(to_process)
        ));
        out.info(&format!("  Files to delete : {to_delete}"));
        return Ok(());
    }

    // ── Pipeline run ──────────────────────────────────────────────────────────
    let (workers, concurrency_strategy) = resolve_concurrency(
        args.workers,
        cfg.pipeline.as_ref().and_then(|p| p.concurrency),
        cfg.pipeline
            .as_ref()
            .and_then(|p| p.concurrency_strategy.as_deref()),
        cores_or_four(),
        true,
    );

    let progress = ProgressCounters::new();
    let pipeline_cfg = PipelineConfig {
        workers,
        concurrency_strategy,
        upload_batch_size: cfg
            .pipeline
            .as_ref()
            .and_then(|p| p.min_upload_batch_size)
            .unwrap_or(64),
        max_tokens: 512,
        progress: Some(progress.clone()),
        skip_upload: args.no_upload,
        label_rules: cfg
            .label_rules
            .iter()
            .map(|r| crate::pipeline::LabelRule {
                pattern: r.pattern.clone(),
                add: r.add.clone(),
            })
            .collect(),
        ..Default::default()
    };

    // ── Multi-stage progress display ──────────────────────────────────────────
    let file_bar = prog.file_bar(0, "Indexing");
    let chunk_bar = prog.stage("0 chunks embedded");

    let progress_task = {
        let p = progress.clone();
        let fb = file_bar.clone();
        let cb = chunk_bar.clone();
        tokio::spawn(async move {
            loop {
                let (total, _, done, chunks) = p.snapshot();
                if total > 0 {
                    fb.set_length(total as u64);
                    fb.set_position(done as u64);
                }
                cb.set_message(format!("{chunks} chunks embedded"));
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        })
    };

    let stats = run_pipeline(
        &pipeline_cfg,
        groups.clone(),
        embedder,
        store.clone(),
        known_revisions,
    )
    .await?;

    progress_task.abort();
    file_bar.finish_and_clear();
    chunk_bar.finish_and_clear();

    out.debug_msg(&format!(
        "pipeline: {} files processed  {} chunks upserted  {} skipped  {} deleted",
        stats.files_processed, stats.chunks_upserted, stats.files_skipped, stats.files_deleted
    ));
    if verbose >= 4 {
        let (total, queued, done, chunks) = progress.snapshot();
        out.debug_msg(&format!(
            "ProgressCounters: total={total} queued={queued} done={done} chunks={chunks}"
        ));
    }

    // ── Update state DB with new revisions ────────────────────────────────────
    // Review fix (ADR-057): only record a revision for a file that *fully* completed this run
    // (`stats.processed_revisions` — see its doc comment). Previously this re-queried every
    // fileSet item's current revision and wrote all of them unconditionally, regardless of
    // whether `run_pipeline` actually finished that file — a file whose embedding failed
    // partway through (streaming can leave some of its chunks already stored) would still get
    // marked "known" and never be retried, despite having incomplete content in the store.
    // Skipped files need no write (their existing DB entry is already correct); deleted files
    // are still detected via `list_current_state`, unrelated to processing outcome.
    let t_db = std::time::Instant::now();
    {
        for (key, rev) in &stats.processed_revisions {
            db.set_file_revision(key, rev)
                .map_err(|e| anyhow::anyhow!("DB write error: {e}"))?;
        }
        let current = list_current_state(&groups).await?;
        let current_keys: std::collections::HashSet<&str> =
            current.iter().map(|(k, _, _)| k.as_str()).collect();
        for file in db
            .get_file_revisions()
            .unwrap_or_default()
            .keys()
            .filter(|k| !current_keys.contains(k.as_str()))
            .cloned()
            .collect::<Vec<_>>()
        {
            let _ = db.delete_file(&file);
        }
    }
    out.debug_msg(&format!("DB flush: {}ms", t_db.elapsed().as_millis()));

    let elapsed_ms = t0.elapsed().as_millis();
    if format == OutputFormat::Json {
        out.data_json(&serde_json::json!({
            "filesProcessed": stats.files_processed,
            "filesSkipped": stats.files_skipped,
            "filesDeleted": stats.files_deleted,
            "chunksUpserted": stats.chunks_upserted,
            "elapsedMs": elapsed_ms,
        }));
    } else {
        out.success(&format!(
            "Done.  Processed: {}  Skipped: {}  Deleted: {}  Chunks: {}  ({elapsed_ms}ms)",
            stats.files_processed, stats.files_skipped, stats.files_deleted, stats.chunks_upserted,
        ));
    }
    // Write index metadata for `virage check` comparisons.
    let _ = store
        .write_meta(&crate::stores::IndexMeta {
            model: cfg.providers.embedder.package.clone(),
            dimensions: dims,
        })
        .await;
    let _ = db.record_cli_command("index", t0.elapsed().as_millis() as u64, true);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_dynamic(strategy: &Option<Arc<dyn ConcurrencyStrategy>>) -> bool {
        // FixedWorkers vs. RamSampling can't be distinguished by downcasting (no Any bound on
        // ConcurrencyStrategy), but resolve_concurrency's contract is exactly "Some ⇒
        // RamSampling, None ⇒ FixedWorkers via coordinator.rs's fallback" — Option::is_some()
        // is the intended, documented way callers read the decision.
        strategy.is_some()
    }

    #[test]
    fn no_override_defaults_to_dynamic_when_requested() {
        let (ceiling, strategy) = resolve_concurrency(None, None, None, 8, true);
        assert_eq!(ceiling, 8);
        assert!(is_dynamic(&strategy));
    }

    #[test]
    fn no_override_defaults_to_fixed_when_dynamic_not_requested() {
        // The virage bench index fix: default_dynamic: false keeps benchmarks deterministic.
        let (ceiling, strategy) = resolve_concurrency(None, None, None, 8, false);
        assert_eq!(ceiling, 8);
        assert!(!is_dynamic(&strategy));
    }

    #[test]
    fn explicit_workers_pins_fixed_even_when_default_is_dynamic() {
        let (ceiling, strategy) = resolve_concurrency(Some(3), None, None, 8, true);
        assert_eq!(ceiling, 3);
        assert!(
            !is_dynamic(&strategy),
            "an explicit --workers count should pin FixedWorkers, not RamSampling"
        );
    }

    #[test]
    fn cfg_strategy_ram_sampling_overrides_default_fixed() {
        let (ceiling, strategy) = resolve_concurrency(None, None, Some("ramSampling"), 8, false);
        assert_eq!(ceiling, 8);
        assert!(
            is_dynamic(&strategy),
            "explicit concurrencyStrategy: ramSampling should override a fixed default"
        );
    }

    #[test]
    fn cfg_strategy_ram_sampling_overrides_explicit_workers_pin() {
        // Explicit strategy selection wins even when --workers/concurrency was also set — the
        // numeric value becomes RamSampling's ceiling instead of a hard FixedWorkers pin.
        let (ceiling, strategy) = resolve_concurrency(Some(5), None, Some("ramSampling"), 8, false);
        assert_eq!(ceiling, 5);
        assert!(is_dynamic(&strategy));
    }

    #[test]
    fn cfg_strategy_fixed_overrides_dynamic_default() {
        let (ceiling, strategy) = resolve_concurrency(None, None, Some("fixed"), 8, true);
        assert_eq!(ceiling, 8);
        assert!(!is_dynamic(&strategy));
    }

    #[test]
    fn unrecognized_cfg_strategy_falls_back_to_default_dynamic() {
        let (_, strategy) = resolve_concurrency(None, None, Some("bogus"), 8, true);
        assert!(is_dynamic(&strategy));
        let (_, strategy) = resolve_concurrency(None, None, Some("bogus"), 8, false);
        assert!(!is_dynamic(&strategy));
    }

    #[test]
    fn args_workers_takes_priority_over_cfg_workers() {
        let (ceiling, _) = resolve_concurrency(Some(2), Some(6), None, 8, true);
        assert_eq!(ceiling, 2);
    }
}
