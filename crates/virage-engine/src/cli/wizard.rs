use crate::output::{Out, OutputFormat};

use super::util::{detect_file_types, multiselect_step, select_step, spinner, FILE_TYPE_META};
use super::ConfigPathArg;

fn package_to_builtin(pkg: &str) -> Option<&'static str> {
    match pkg {
        "@vivantel/virage-chunker-ce-lang" => Some("lang"),
        "@vivantel/virage-chunker-ce-md" => Some("md"),
        "@vivantel/virage-chunker-ce-pdf" => Some("pdf"),
        "@vivantel/virage-chunker-ce-docx" => Some("docx"),
        "@vivantel/virage-chunker-ce-latex" => Some("latex"),
        "@vivantel/virage-embedder-onnx" => Some("onnx"),
        "@vivantel/virage-embedder-fastembed" => Some("fastembed"),
        "@vivantel/virage-store-lancedb" => Some("lancedb"),
        "@vivantel/virage-store-qdrant" => Some("qdrant"),
        "@vivantel/virage-store-postgres" => Some("postgres"),
        "@vivantel/virage-store-chromadb" => Some("chromadb"),
        "@vivantel/virage-reranker-cross-encoder" => Some("cross-encoder"),
        "@vivantel/virage-source-git" => Some("git"),
        "@vivantel/virage-source-localfs" => Some("localfs"),
        _ => None,
    }
}

pub fn cmd_init(
    _args: ConfigPathArg,
    verbose: u8,
    format: OutputFormat,
    config: &str,
) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);

    out.section("Virage Setup");
    out.dim("Esc: back to the previous step.");
    println!();

    // Wizard state
    let default_config = if config.is_empty() {
        "virage.config.json".to_string()
    } else {
        config.to_string()
    };
    let cwd = std::env::current_dir()?;
    let mut config_path = default_config.clone();
    let mut selected_type_indices: Vec<usize> = vec![];
    let mut selected_agents: Vec<&str> = vec!["claude-code"];
    let mut embedder_pkg = "@vivantel/virage-embedder-onnx";
    let mut store_pkg = "@vivantel/virage-store-lancedb";
    let source_pkg = "@vivantel/virage-source-git"; // default, no prompt (H2)
    let mut reranker_pkg: Option<&str> = None;
    let mut use_hybrid = false;
    let mut hybrid_alpha: f32 = 0.6;
    let mut install_scope = "local";

    let mut step = 0usize;

    loop {
        match step {
            // ── Step 0: Config path (H1: Select instead of Input) ─────────────
            0 => {
                let config_exists = std::path::Path::new(&config_path).exists();
                let choices: [&'static str; 3] = if config_exists {
                    [
                        "Use default path (overwrite existing)",
                        "Enter custom path",
                        "Exit",
                    ]
                } else {
                    ["Use default path", "Enter custom path", "Exit"]
                };
                match select_step(
                    &format!("Config path (default: {default_config})"),
                    &choices,
                    0,
                )? {
                    None | Some(2) => {
                        out.info("Cancelled.");
                        std::process::exit(0);
                    }
                    Some(1) => {
                        config_path = inquire::Text::new("Config file path")
                            .with_default(&default_config)
                            .with_render_config(super::util::virage_render_config())
                            .prompt()?;
                    }
                    Some(_) => {
                        config_path = default_config.clone();
                    }
                }
                step += 1;
            }

            // ── Step 1: File type detection + multiselect (H2: use CWD) ───────
            1 => {
                let pb = spinner("Detecting file types...");
                let counts = detect_file_types(&cwd);
                pb.finish_and_clear();

                let content_labels: Vec<String> = FILE_TYPE_META
                    .iter()
                    .map(|(key, label, _, _)| {
                        if let Some(n) = counts.get(*key) {
                            format!("{label} [{n} files]")
                        } else {
                            label.to_string()
                        }
                    })
                    .collect();
                let default_selected: Vec<usize> = FILE_TYPE_META
                    .iter()
                    .enumerate()
                    .filter_map(|(i, (key, _, _, _))| counts.contains_key(*key).then_some(i))
                    .collect();

                let picked = match multiselect_step(
                    "File types to index",
                    &content_labels,
                    &default_selected,
                )? {
                    None => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    Some(p) => p,
                };

                if picked.is_empty() {
                    out.warn("Select at least one file type.");
                    continue;
                }

                selected_type_indices = picked;
                step += 1;
            }

            // ── Step 2: Coding agents (H3) ────────────────────────────────────
            2 => {
                let agent_labels = [
                    "Claude Code (claude-code)",
                    "GitHub Copilot (copilot)",
                    "OpenAI Codex (codex)",
                    "Antigravity",
                ];
                let agent_keys = ["claude-code", "copilot", "codex", "antigravity"];
                let agent_label_strings: Vec<String> =
                    agent_labels.iter().map(|s| s.to_string()).collect();

                let picked =
                    match multiselect_step("Coding agents to support", &agent_label_strings, &[0])?
                    {
                        None => {
                            step = step.saturating_sub(1);
                            continue;
                        }
                        Some(p) => p,
                    };

                selected_agents = agent_keys
                    .iter()
                    .enumerate()
                    .filter_map(|(i, &k)| if picked.contains(&i) { Some(k) } else { None })
                    .collect();
                step += 1;
            }

            // ── Step 3: Embedder ──────────────────────────────────────────────
            3 => {
                let choices = [
                    "ONNX (local, no API key needed)",
                    "OpenAI text-embedding-3-small",
                    "Cohere embed-english-v3",
                    "FastEmbed (Qdrant, local)",
                ];
                match select_step("Embedder", &choices, 0)? {
                    None => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    Some(1) => embedder_pkg = "@vivantel/virage-embedder-openai",
                    Some(2) => embedder_pkg = "@vivantel/virage-embedder-cohere",
                    Some(3) => embedder_pkg = "@vivantel/virage-embedder-fastembed",
                    Some(_) => embedder_pkg = "@vivantel/virage-embedder-onnx",
                }
                step += 1;
            }

            // ── Step 4: Vector store ──────────────────────────────────────────
            4 => {
                let choices = [
                    "LanceDB (local, file-based)",
                    "Qdrant (self-hosted or cloud)",
                    "PostgreSQL + pgvector",
                    "ChromaDB",
                ];
                match select_step("Vector store", &choices, 0)? {
                    None => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    Some(1) => store_pkg = "@vivantel/virage-store-qdrant",
                    Some(2) => store_pkg = "@vivantel/virage-store-postgres",
                    Some(3) => store_pkg = "@vivantel/virage-store-chromadb",
                    Some(_) => store_pkg = "@vivantel/virage-store-lancedb",
                }
                step += 1;
            }

            // ── Step 5: Reranker ──────────────────────────────────────────────
            5 => {
                let choices = [
                    "None (skip, use vector similarity only)",
                    "ONNX cross-encoder (local, improves precision)",
                    "LLM re-ranker — Anthropic API (claude-haiku-4-5)",
                ];
                match select_step("Reranker", &choices, 0)? {
                    None => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    Some(1) => reranker_pkg = Some("@vivantel/virage-reranker-cross-encoder"),
                    Some(2) => reranker_pkg = Some("@vivantel/virage-reranker-llm"),
                    Some(_) => reranker_pkg = None,
                }
                step += 1;
            }

            // ── Step 6: Hybrid search (unconditional — G7) ───────────────────
            6 => {
                let choices = ["Yes — enable hybrid (dense + sparse BM25)", "No"];
                match select_step("Enable hybrid search?", &choices, 0)? {
                    None => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    Some(1) => {
                        use_hybrid = false;
                        step += 1;
                        continue;
                    }
                    Some(_) => {}
                }
                use_hybrid = true;

                // G8: alpha sub-select
                let alpha_choices = [
                    "0.6 (default — balanced)",
                    "0.3 (sparse-heavy)",
                    "0.8 (dense-heavy)",
                    "Custom",
                ];
                loop {
                    match select_step(
                        "Hybrid alpha (0 = sparse only, 1 = dense only)",
                        &alpha_choices,
                        0,
                    )? {
                        None => {
                            use_hybrid = false;
                            break;
                        }
                        Some(1) => {
                            hybrid_alpha = 0.3;
                            break;
                        }
                        Some(2) => {
                            hybrid_alpha = 0.8;
                            break;
                        }
                        Some(3) => {
                            let raw = inquire::Text::new("Alpha (0.0–1.0)")
                                .with_render_config(super::util::virage_render_config())
                                .prompt()?;
                            match raw.parse::<f32>() {
                                Ok(v) if (0.0..=1.0).contains(&v) => {
                                    hybrid_alpha = v;
                                    break;
                                }
                                _ => {
                                    out.warn("Enter a number between 0.0 and 1.0.");
                                }
                            }
                        }
                        Some(_) => {
                            hybrid_alpha = 0.6;
                            break;
                        }
                    }
                }
                step += 1;
            }

            // ── Step 7: Install scope (H5) ───────────────────────────────────
            7 => {
                let choices = ["Local (this project)", "Global (all projects)"];
                match select_step("Install scope", &choices, 0)? {
                    None => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    Some(1) => install_scope = "global",
                    Some(_) => install_scope = "local",
                }
                step += 1;
            }

            // ── Step 8: Summary + confirm ─────────────────────────────────────
            8 => {
                let type_names: Vec<&str> = selected_type_indices
                    .iter()
                    .map(|&i| FILE_TYPE_META[i].1)
                    .collect();

                out.section("Summary");
                // H12: formatted summary box
                let summary = format_wizard_summary(
                    &config_path,
                    &type_names,
                    &selected_agents,
                    embedder_pkg,
                    store_pkg,
                    reranker_pkg,
                    use_hybrid,
                    hybrid_alpha,
                    install_scope,
                );
                println!("{summary}");
                println!();

                let choices = ["Write config", "Cancel"];
                match select_step("Confirm", &choices, 0)? {
                    None => {
                        step = step.saturating_sub(1);
                        continue;
                    }
                    Some(1) => {
                        out.info("Cancelled.");
                        return Ok(());
                    }
                    _ => {}
                }
                break;
            }

            _ => break,
        }
    }

    // ── Build config ──────────────────────────────────────────────────────────
    // Group selected types by chunker package → one fileSet per chunker.
    let mut chunker_groups: std::collections::BTreeMap<&str, (Vec<&str>, Vec<&str>)> =
        std::collections::BTreeMap::new();
    for &i in &selected_type_indices {
        let (_, _, patterns, chunker) = FILE_TYPE_META[i];
        let entry = chunker_groups.entry(chunker).or_default();
        entry.0.extend_from_slice(patterns);
        entry.1.push(FILE_TYPE_META[i].0);
    }

    let mut file_sets = Vec::new();
    for (chunker, (patterns, type_names)) in &chunker_groups {
        let set_name = if type_names.len() == 1 {
            type_names[0].to_lowercase().replace(" / ", "-")
        } else {
            "code".to_string()
        };
        // G2: emit builtin key + G3 chunker options
        let chunker_spec = if let Some(builtin) = package_to_builtin(chunker) {
            let options = chunker_options_for(builtin);
            if options.is_null() {
                serde_json::json!({ "builtin": builtin })
            } else {
                serde_json::json!({ "builtin": builtin, "options": options })
            }
        } else {
            serde_json::json!({ "package": chunker })
        };
        file_sets.push(serde_json::json!({
            "name": set_name,
            "source": "default",
            "include": patterns,
            "chunkers": [chunker_spec]
        }));
    }

    // G2/G4: embedder with builtin key and default options
    let embedder_spec = if let Some(builtin) = package_to_builtin(embedder_pkg) {
        let opts = embedder_options_for(builtin);
        serde_json::json!({ "builtin": builtin, "options": opts })
    } else {
        let opts = embedder_options_for(embedder_pkg);
        serde_json::json!({ "package": embedder_pkg, "options": opts })
    };

    // G2/G5: vectorStore with builtin key and default options
    let store_spec = if let Some(builtin) = package_to_builtin(store_pkg) {
        let opts = store_options_for(builtin);
        serde_json::json!({ "builtin": builtin, "options": opts })
    } else {
        serde_json::json!({ "package": store_pkg })
    };

    // v2: source goes in top-level "sources" map; filesets reference it by name
    let source_spec = if let Some(builtin) = package_to_builtin(source_pkg) {
        serde_json::json!({ "builtin": builtin })
    } else {
        serde_json::json!({ "package": source_pkg })
    };

    let mut providers = serde_json::json!({
        "embedder": embedder_spec,
        "vectorStore": store_spec
    });

    // G2/G6: reranker with builtin key and default options
    if let Some(r) = reranker_pkg {
        let reranker_spec = if let Some(builtin) = package_to_builtin(r) {
            let opts = reranker_options_for(builtin);
            serde_json::json!({ "builtin": builtin, "options": opts })
        } else {
            serde_json::json!({ "package": r })
        };
        providers["reranker"] = reranker_spec;
    }

    // H7: default ignore patterns
    let mut ignore_patterns = vec![
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/build/**",
        "**/.virage/**",
        "**/target/**",
        "**/__pycache__/**",
        "**/.next/**",
        "**/vendor/**",
    ];
    // Add language-specific ignore patterns
    let java_kotlin_selected = selected_type_indices
        .iter()
        .any(|&i| FILE_TYPE_META[i].0 == "Java / Kotlin");
    let csharp_selected = selected_type_indices
        .iter()
        .any(|&i| FILE_TYPE_META[i].0 == "C# / C++");
    if java_kotlin_selected {
        ignore_patterns.push("**/target/**");
        ignore_patterns.push("**/*.class");
    }
    if csharp_selected {
        ignore_patterns.push("**/bin/**");
        ignore_patterns.push("**/obj/**");
    }
    ignore_patterns.dedup();

    // G9: hybrid goes in "search" section, not "pipeline"
    // H6: fixed $schema URL (already set above)
    let mut cfg = serde_json::json!({
        "$schema": "https://unpkg.com/@vivantel/virage-core/schemas/virage.config.schema.json",
        "version": "2",
        "sources": {
            "default": source_spec
        },
        "providers": providers,
        "fileSets": file_sets,
        "ignore": ignore_patterns,
        "agents": selected_agents,
        "installScope": install_scope,
        "telemetry": {
            "enabled": true,
            "endpoint": "https://telemetry.vivantel.dev",
            "tiers": { "implicit": true }
        }
    });

    if use_hybrid {
        cfg["search"] = serde_json::json!({
            "hybrid": true,
            "hybridAlpha": hybrid_alpha
        });
    }

    // H11: rotate existing backup slots before writing
    rotate_config_backup(std::path::Path::new(&config_path))?;
    std::fs::write(&config_path, serde_json::to_string_pretty(&cfg)?)?;
    println!();
    out.success(&format!("Config written to {config_path}"));

    // H13: Next steps
    println!();
    out.info("Next steps:");
    out.info("  1. Run `virage validate` to check the config");
    out.info("  2. Run `virage index` to build the search index");
    if store_pkg.contains("qdrant") {
        out.dim("     Note: Qdrant requires a running server. Start with: docker run -p 6333:6333 qdrant/qdrant");
    }
    Ok(())
}

// G3: chunker default options per builtin key
fn chunker_options_for(builtin: &str) -> serde_json::Value {
    match builtin {
        "lang" => serde_json::json!({ "maxTokens": 512 }),
        "pdf" | "docx" | "latex" => {
            serde_json::json!({ "maxTokens": 512, "overlapSentences": 1 })
        }
        _ => serde_json::Value::Null,
    }
}

// G4: embedder default options per builtin key or package name
fn embedder_options_for(key: &str) -> serde_json::Value {
    match key {
        "onnx" => serde_json::json!({ "model": "Xenova/all-MiniLM-L6-v2", "dimensions": 384 }),
        "fastembed" => {
            serde_json::json!({ "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 })
        }
        "@vivantel/virage-embedder-openai" => {
            serde_json::json!({ "model": "text-embedding-3-small", "dimensions": 1536 })
        }
        "@vivantel/virage-embedder-cohere" => {
            serde_json::json!({ "model": "embed-english-v3.0", "dimensions": 1024 })
        }
        _ => serde_json::json!({}),
    }
}

// G5: vector store default options per builtin key
fn store_options_for(builtin: &str) -> serde_json::Value {
    match builtin {
        "lancedb" => serde_json::json!({ "uri": ".virage/lancedb" }),
        "qdrant" => {
            serde_json::json!({ "url": "http://localhost:6333", "collectionName": "virage" })
        }
        "postgres" => {
            serde_json::json!({ "connectionString": "postgresql://localhost/virage" })
        }
        "chromadb" => {
            serde_json::json!({ "url": "http://localhost:8000", "collectionName": "virage" })
        }
        _ => serde_json::json!({}),
    }
}

// G6: reranker default options per builtin key
fn reranker_options_for(builtin: &str) -> serde_json::Value {
    match builtin {
        "cross-encoder" => {
            serde_json::json!({
                "model": "cross-encoder/ms-marco-MiniLM-L-12-v2",
                "topK": 5
            })
        }
        "llm" => serde_json::json!({ "model": "claude-haiku-4-5", "topK": 5 }),
        _ => serde_json::json!({}),
    }
}

// H11: rotate .bak.N slots (max 5) before overwriting a config file
fn rotate_config_backup(path: &std::path::Path) -> anyhow::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    // Shift .bak.4 → .bak.5 … .bak.1 → .bak.2, then copy current → .bak.1
    for n in (1u8..5).rev() {
        let src = path.with_extension(format!("json.bak.{n}"));
        let dst = path.with_extension(format!("json.bak.{}", n + 1));
        if src.exists() {
            let _ = std::fs::rename(&src, &dst);
        }
    }
    let bak1 = path.with_extension("json.bak.1");
    std::fs::copy(path, &bak1)?;
    Ok(())
}

// H12: produce a ╔═...═╗ summary box with all wizard selections
#[allow(clippy::too_many_arguments)]
fn format_wizard_summary(
    config_path: &str,
    type_names: &[&str],
    selected_agents: &[&str],
    embedder_pkg: &str,
    store_pkg: &str,
    reranker_pkg: Option<&str>,
    use_hybrid: bool,
    hybrid_alpha: f32,
    install_scope: &str,
) -> String {
    use console::style;

    let embedder_short = embedder_pkg.split('/').next_back().unwrap_or(embedder_pkg);
    let store_short = store_pkg.split('/').next_back().unwrap_or(store_pkg);

    let reranker_line = match reranker_pkg {
        Some(pkg) => pkg.split('/').next_back().unwrap_or(pkg).to_string(),
        None => "none".to_string(),
    };
    let hybrid_line = if use_hybrid {
        format!("yes  (α = {hybrid_alpha:.2})")
    } else {
        "no".to_string()
    };

    let types_line = if type_names.is_empty() {
        "(none)".to_string()
    } else {
        type_names.join(", ")
    };
    let agents_line = if selected_agents.is_empty() {
        "(none)".to_string()
    } else {
        selected_agents.join(", ")
    };

    let rows: &[(&str, String)] = &[
        ("Config", config_path.to_string()),
        ("File types", types_line),
        ("Agents", agents_line),
        ("Embedder", embedder_short.to_string()),
        ("Vector store", store_short.to_string()),
        ("Reranker", reranker_line),
        ("Hybrid search", hybrid_line),
        ("Install scope", install_scope.to_string()),
    ];

    let label_w = rows.iter().map(|(k, _)| k.len()).max().unwrap_or(0);
    let value_w = rows.iter().map(|(_, v)| v.len()).max().unwrap_or(0);
    let inner_w = label_w + 3 + value_w; // "  label  :  value"

    let top = format!("╔{}╗", "═".repeat(inner_w + 2));
    let bot = format!("╚{}╝", "═".repeat(inner_w + 2));

    let mut lines = vec![style(top).cyan().to_string()];
    for (k, v) in rows {
        let label = format!("{k:>label_w$}");
        let row = format!("║ {label}  :  {v:<value_w$} ║");
        lines.push(style(row).cyan().to_string());
    }
    lines.push(style(bot).cyan().to_string());
    lines.join("\n")
}
