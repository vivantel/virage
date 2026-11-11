use std::path::Path;

use crate::config::find_config;
use crate::output::{Out, OutputFormat};

use super::util::{multiselect_step, spinner};

/// Returns the correct npm binary name for the current OS.
/// On Windows, `npm` is a batch script (`npm.cmd`), not a native executable.
fn npm_bin() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

struct PackageStatus {
    name: String,
    current: String,
    latest: String,
    outdated: bool,
}

/// Queries `npm view <pkg> version --json` and returns the latest published version.
fn get_npm_latest(npm: &str, pkg: &str) -> Option<String> {
    let output = std::process::Command::new(npm)
        .args(["view", pkg, "version", "--json", "--prefer-online"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    serde_json::from_str::<String>(&s).ok()
}

/// Returns the currently installed version of a package, checking local node_modules
/// then falling back to `npm list --global`.
fn get_npm_current(npm: &str, pkg: &str, cwd: &Path) -> Option<String> {
    let local_pkg = cwd.join("node_modules").join(pkg).join("package.json");
    if let Ok(raw) = std::fs::read_to_string(local_pkg) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(ver) = v.get("version").and_then(|v| v.as_str()) {
                return Some(ver.to_string());
            }
        }
    }
    let out = std::process::Command::new(npm)
        .args(["list", pkg, "--global", "--json", "--depth=0"])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(&s).ok()?;
    v.get("dependencies")
        .and_then(|d| d.get(pkg))
        .and_then(|p| p.get("version"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Discovers all @vivantel/* packages referenced in virage.config.json and package.json.
fn discover_virage_packages(cwd: &Path, config_path: &str) -> Vec<String> {
    let mut packages = std::collections::BTreeSet::new();

    if let Ok(raw) = std::fs::read_to_string(config_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(providers) = v.get("providers").and_then(|p| p.as_object()) {
                for provider in providers.values() {
                    if let Some(pkg) = provider.get("package").and_then(|p| p.as_str()) {
                        packages.insert(pkg.to_string());
                    }
                }
            }
            if let Some(agents) = v.get("agents").and_then(|a| a.as_array()) {
                for agent in agents {
                    if let Some(pkg) = agent.get("package").and_then(|p| p.as_str()) {
                        packages.insert(pkg.to_string());
                    }
                }
            }
            if let Some(file_sets) = v.get("fileSets").and_then(|f| f.as_array()) {
                for fs in file_sets {
                    if let Some(chunkers) = fs.get("chunkers").and_then(|c| c.as_array()) {
                        for chunker in chunkers {
                            if let Some(pkg) = chunker.get("package").and_then(|p| p.as_str()) {
                                packages.insert(pkg.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let pkg_json = cwd.join("package.json");
    if let Ok(raw) = std::fs::read_to_string(pkg_json) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            for key in ["dependencies", "devDependencies"] {
                if let Some(deps) = v.get(key).and_then(|d| d.as_object()) {
                    for name in deps.keys() {
                        if name.starts_with("@vivantel/") {
                            packages.insert(name.clone());
                        }
                    }
                }
            }
        }
    }

    packages.into_iter().collect()
}

pub fn cmd_update(verbose: u8, format: OutputFormat) -> anyhow::Result<()> {
    let out = Out::new(verbose, format);
    use console::style;

    let npm = npm_bin();
    let cwd = std::env::current_dir()?;

    out.section("Virage Update");

    // ── 1. Discover packages ──────────────────────────────────────────────────
    let config_path = find_config().unwrap_or_else(|| "virage.config.json".into());
    let packages = discover_virage_packages(&cwd, &config_path);

    if packages.is_empty() {
        out.warn("No @vivantel/* packages found.");
        return Ok(());
    }

    // ── 2. Check versions ─────────────────────────────────────────────────────
    let pb = spinner("Checking versions...");
    let mut statuses: Vec<PackageStatus> = Vec::new();
    for pkg in &packages {
        pb.set_message(format!("Checking {pkg}..."));
        let current = get_npm_current(npm, pkg, &cwd).unwrap_or_else(|| "not installed".into());
        let latest = get_npm_latest(npm, pkg).unwrap_or_else(|| "unknown".into());
        let outdated = latest != "unknown" && current != "not installed" && current != latest;
        statuses.push(PackageStatus {
            name: pkg.clone(),
            current,
            latest,
            outdated,
        });
    }
    pb.finish_and_clear();

    // ── 3. Display status table ───────────────────────────────────────────────
    println!();
    for s in &statuses {
        let cur_styled = if s.outdated {
            style(&s.current).yellow().to_string()
        } else if s.current == "not installed" {
            style(&s.current).dim().to_string()
        } else {
            style(&s.current).green().to_string()
        };
        let lat_styled = if s.outdated {
            style(&s.latest).green().to_string()
        } else {
            style(&s.latest).dim().to_string()
        };
        println!(
            "  {:45}  {}  →  {}",
            style(&s.name).dim(),
            cur_styled,
            lat_styled
        );
    }
    println!();

    // ── 4. Interactive selection ──────────────────────────────────────────────
    let labels: Vec<String> = statuses
        .iter()
        .map(|s| {
            if s.outdated {
                format!("{} ({} → {})", s.name, s.current, s.latest)
            } else {
                format!("{} ({})", s.name, s.current)
            }
        })
        .collect();

    let default_selected: Vec<usize> = statuses
        .iter()
        .enumerate()
        .filter_map(|(i, s)| s.outdated.then_some(i))
        .collect();

    let selected = match multiselect_step("Packages to update", &labels, &default_selected)? {
        None => {
            out.info("Cancelled.");
            return Ok(());
        }
        Some(s) => s,
    };

    if selected.is_empty() {
        out.info("Nothing selected.");
        return Ok(());
    }

    // ── 5. Install selected packages — I1: single batched npm install -g call ──
    let to_install: Vec<&str> = selected
        .iter()
        .map(|&i| statuses[i].name.as_str())
        .collect();
    out.info(&format!("Installing {} package(s)...", to_install.len()));

    let pkg_args: Vec<String> = to_install.iter().map(|p| format!("{p}@latest")).collect();
    out.dim(&format!("  npm install -g {}", pkg_args.join(" ")));
    let status = std::process::Command::new(npm)
        .arg("install")
        .arg("-g")
        .args(&pkg_args)
        .status();
    match status {
        Ok(s) if s.success() => out.success(&format!("{} package(s) updated", to_install.len())),
        Ok(s) => out.warn(&format!("npm exited with status {s}")),
        Err(e) => out.error(&format!("npm install failed: {e}")),
    }

    // ── 6. Self-update (virage CLI binary) ────────────────────────────────────
    out.dim("Checking virage binary...");
    let self_current =
        get_npm_current(npm, "@vivantel/virage", &cwd).unwrap_or_else(|| "unknown".into());
    let self_latest = get_npm_latest(npm, "@vivantel/virage").unwrap_or_else(|| "unknown".into());

    if self_latest != "unknown" && self_current != self_latest {
        out.info(&format!(
            "Updating virage binary {self_current} → {self_latest}..."
        ));
        let status = std::process::Command::new(npm)
            .args(["install", "-g", "@vivantel/virage@latest"])
            .status();
        match status {
            Ok(s) if s.success() => out.success("virage binary updated."),
            Ok(s) => out.warn(&format!("virage binary update exited {s}")),
            Err(e) => out.error(&format!("virage binary update failed: {e}")),
        }
    } else {
        out.dim("virage binary is up to date.");
    }

    out.success("Update complete.");
    Ok(())
}
