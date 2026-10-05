use std::path::PathBuf;

/// Discover WASM plugin files from the standard search locations.
///
/// Search order:
/// 1. `.virage/plugins/*.wasm` (project-local)
/// 2. `~/.virage/plugins/*.wasm` (user-global)
/// 3. npm packages with `"wasm-plugin"` field in `package.json`
pub fn find_wasm_plugins(project_root: &std::path::Path) -> Vec<PathBuf> {
    let mut found = Vec::new();

    // Project-local plugins
    let local = project_root.join(".virage/plugins");
    collect_wasm_files(&local, &mut found);

    // User-global plugins
    if let Some(home) = home_dir() {
        collect_wasm_files(&home.join(".virage/plugins"), &mut found);
    }

    // npm packages with wasm-plugin field (node_modules scan)
    if let Some(modules) = project_root
        .ancestors()
        .find(|p| p.join("node_modules").exists())
        .map(|p| p.join("node_modules"))
    {
        scan_npm_wasm_plugins(&modules, &mut found);
    }

    found
}

fn collect_wasm_files(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "wasm") {
            out.push(path);
        }
    }
}

fn scan_npm_wasm_plugins(node_modules: &std::path::Path, out: &mut Vec<PathBuf>) {
    let Ok(top) = std::fs::read_dir(node_modules) else {
        return;
    };
    for pkg_entry in top.flatten() {
        check_npm_package(&pkg_entry.path(), out);

        // Handle scoped packages (@scope/pkg)
        if pkg_entry.file_name().to_string_lossy().starts_with('@') {
            if let Ok(scoped) = std::fs::read_dir(pkg_entry.path()) {
                for scoped_entry in scoped.flatten() {
                    check_npm_package(&scoped_entry.path(), out);
                }
            }
        }
    }
}

fn check_npm_package(pkg_dir: &std::path::Path, out: &mut Vec<PathBuf>) {
    let pkg_json = pkg_dir.join("package.json");
    let Ok(text) = std::fs::read_to_string(&pkg_json) else {
        return;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    if let Some(wasm_path) = json.get("wasm-plugin").and_then(|v| v.as_str()) {
        let wasm_file = pkg_dir.join(wasm_path);
        if wasm_file.exists() {
            out.push(wasm_file);
        }
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}
