use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// A cross-file symbol index that maps import paths to their source files.
///
/// This is built during indexing by scanning all source files and extracting
/// their module/package names. During chunking, imports are resolved against
/// this index to determine if they point to real files in the project.
#[derive(Debug, Clone, Default)]
pub struct SymbolIndex {
    /// Maps import path -> list of source files that provide it.
    /// E.g., "std::collections::HashMap" -> ["crates/virage-engine/src/lib.rs"]
    ///      "./utils" -> ["src/utils.ts"]
    index: HashMap<String, Vec<PathBuf>>,

    /// Maps file path -> its own module/package name (for self-references).
    /// E.g., "src/utils.ts" -> "utils"
    file_modules: HashMap<PathBuf, String>,
}

impl SymbolIndex {
    /// Create a new empty symbol index.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a file's module name to the index.
    ///
    /// `file_path` is the path relative to the project root.
    /// `module_name` is the name other files would use to import this file.
    pub fn add_file_module(&mut self, file_path: PathBuf, module_name: String) {
        self.file_modules
            .insert(file_path.clone(), module_name.clone());
        self.index.entry(module_name).or_default().push(file_path);
    }

    /// Add an explicit import path mapping.
    pub fn add_import_mapping(&mut self, import_path: String, file_path: PathBuf) {
        self.index.entry(import_path).or_default().push(file_path);
    }

    /// Check if an import can be resolved to a real file in the project.
    ///
    /// Returns `true` if the import path matches a known module/file in the index.
    /// Handles both absolute (e.g., "std::collections") and relative (e.g., "./utils") imports.
    pub fn resolve_import(&self, import_path: &str, from_file: &Path) -> bool {
        // Direct match in index
        if self.index.contains_key(import_path) {
            return true;
        }

        // Try resolving relative imports
        if import_path.starts_with('.') {
            return self.resolve_relative_import(import_path, from_file);
        }

        // For Rust, try crate-relative paths (e.g., "crate::foo::bar")
        if let Some(relative) = import_path.strip_prefix("crate::") {
            return self.index.contains_key(relative);
        }

        // For Rust, try super-relative paths (e.g., "super::foo")
        if import_path.starts_with("super::") {
            return self.resolve_super_import(import_path, from_file);
        }

        false
    }

    /// Resolve a relative import like "./utils" or "../foo/bar".
    fn resolve_relative_import(&self, import_path: &str, from_file: &Path) -> bool {
        let from_dir = from_file.parent().unwrap_or(Path::new(""));

        // Handle ./ and ../ prefixes
        let target_path = if let Some(stripped) = import_path.strip_prefix("./") {
            from_dir.join(stripped)
        } else if import_path.starts_with("../") {
            from_dir.join(import_path)
        } else {
            return false;
        };

        // Normalize the path
        let normalized = Self::normalize_path(&target_path);
        let normalized_stem = Path::new(&normalized)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");

        // Check if any indexed file matches this path (with or without extension)
        for (module, files) in &self.index {
            for file in files {
                let file_stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                let file_path_str = file.to_string_lossy();

                // Match by module name, file path, or normalized path
                if module == &normalized
                    || module == normalized_stem
                    || file_path_str == normalized
                    || file_stem == normalized
                    || file_stem == normalized_stem
                {
                    return true;
                }

                // Also check parent directory for index files (e.g., ./utils -> ./utils/index.ts)
                if let Some(parent) = file.parent() {
                    let parent_name = parent.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    if parent_name == normalized || parent_name == normalized_stem {
                        return true;
                    }
                }
            }
        }

        false
    }

    /// Resolve a `super::` import in Rust.
    fn resolve_super_import(&self, import_path: &str, from_file: &Path) -> bool {
        let from_dir = from_file.parent().unwrap_or(Path::new(""));
        let parent_dir = from_dir.parent().unwrap_or(Path::new(""));
        let relative = &import_path["super::".len()..];

        let target_path = parent_dir.join(relative);
        let normalized = Self::normalize_path(&target_path);

        for (module, files) in &self.index {
            for file in files {
                let file_stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                let file_path_str = file.to_string_lossy();

                if module == &normalized || file_path_str == normalized || file_stem == normalized {
                    return true;
                }
            }
        }

        false
    }

    /// Normalize a path by removing extensions and converting to forward slashes.
    fn normalize_path(path: &Path) -> String {
        let mut s = path.to_string_lossy().to_string();
        // Remove common extensions
        for ext in [
            ".rs", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".kt", ".scala",
        ] {
            if s.ends_with(ext) {
                s.truncate(s.len() - ext.len());
                break;
            }
        }
        // Convert backslashes to forward slashes for cross-platform consistency
        s.replace('\\', "/")
    }

    /// Get the number of files in the index.
    pub fn file_count(&self) -> usize {
        self.file_modules.len()
    }

    /// Get the number of unique import paths in the index.
    pub fn import_path_count(&self) -> usize {
        self.index.len()
    }
}

/// Build a symbol index from a list of source files.
///
/// This scans each file to extract its module/package name based on the file
/// path and language conventions.
pub fn build_symbol_index(files: &[(PathBuf, String)]) -> SymbolIndex {
    let mut index = SymbolIndex::new();

    for (file_path, source_format) in files {
        if let Some(module_name) = extract_module_name(file_path, source_format) {
            index.add_file_module(file_path.clone(), module_name);
        }
    }

    index
}

/// Extract the module/package name from a file path based on language conventions.
fn extract_module_name(file_path: &Path, source_format: &str) -> Option<String> {
    let path_str = file_path.to_string_lossy();

    match source_format {
        "rust" | "rs" => extract_rust_module(&path_str),
        "typescript" | "ts" | "tsx" => extract_ts_module(&path_str),
        "javascript" | "js" | "jsx" => extract_ts_module(&path_str), // Same logic
        "python" | "py" => extract_python_module(&path_str),
        "go" => extract_go_module(&path_str),
        "java" => extract_java_module(&path_str),
        "c" | "cpp" | "cc" | "cxx" | "h" | "hpp" => extract_c_module(&path_str),
        "csharp" | "cs" => extract_csharp_module(&path_str),
        "ruby" | "rb" => extract_ruby_module(&path_str),
        _ => None,
    }
}

/// Extract Rust module path from file path.
/// E.g., "crates/virage-engine/src/chunkers/lang.rs" -> "virage_engine::chunkers::lang"
fn extract_rust_module(path: &str) -> Option<String> {
    // Find the src/ directory and extract module path from there
    let src_idx = path.find("/src/")?;
    let after_src = &path[src_idx + 5..]; // Skip "/src/"

    // Remove .rs extension
    let without_ext = after_src.strip_suffix(".rs")?;

    // Convert path separators to ::
    let module = without_ext.replace('/', "::");

    // Handle mod.rs and lib.rs specially
    if module.ends_with("::mod") || module == "mod" {
        let stripped = module.strip_suffix("::mod").unwrap_or("");
        return Some(stripped.to_string());
    }
    if module.ends_with("::lib") || module == "lib" {
        let stripped = module.strip_suffix("::lib").unwrap_or("");
        return Some(stripped.to_string());
    }

    Some(module)
}

/// Extract TypeScript/JavaScript module name from file path.
/// E.g., "packages/virage-core/src/core/utils.ts" -> "utils"
///      "packages/virage-core/src/core/utils/index.ts" -> "utils"
fn extract_ts_module(path: &str) -> Option<String> {
    let file_name = Path::new(path).file_stem()?.to_str()?;

    // Handle index.ts files - use parent directory name
    if file_name == "index" {
        return Path::new(path)
            .parent()?
            .file_name()?
            .to_str()
            .map(|s| s.to_string());
    }

    Some(file_name.to_string())
}

/// Extract Python module name from file path.
/// E.g., "src/utils.py" -> "utils"
///      "src/pkg/__init__.py" -> "pkg"
fn extract_python_module(path: &str) -> Option<String> {
    let file_name = Path::new(path).file_stem()?.to_str()?;

    if file_name == "__init__" {
        return Path::new(path)
            .parent()?
            .file_name()?
            .to_str()
            .map(|s| s.to_string());
    }

    Some(file_name.to_string())
}

/// Extract Go package name from file path.
/// Go uses the directory name as the package name.
fn extract_go_module(path: &str) -> Option<String> {
    Path::new(path)
        .parent()?
        .file_name()?
        .to_str()
        .map(|s| s.to_string())
}

/// Extract Java package name from file path.
/// Java uses the directory structure as the package name.
fn extract_java_module(path: &str) -> Option<String> {
    let src_idx = path.find("/src/")?;
    let after_src = &path[src_idx + 5..]; // Skip "/src/"

    // Remove .java extension
    let without_ext = after_src.strip_suffix(".java")?;

    // Convert path separators to .
    Some(without_ext.replace('/', "."))
}

/// Extract C/C++ module name from file path.
/// C/C++ doesn't have a standard module system, but we can use the file name.
fn extract_c_module(path: &str) -> Option<String> {
    Path::new(path).file_stem()?.to_str().map(|s| s.to_string())
}

/// Extract C# module name from file path.
fn extract_csharp_module(path: &str) -> Option<String> {
    Path::new(path).file_stem()?.to_str().map(|s| s.to_string())
}

/// Extract Ruby module name from file path.
fn extract_ruby_module(path: &str) -> Option<String> {
    Path::new(path).file_stem()?.to_str().map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_symbol_index_new() {
        let index = SymbolIndex::new();
        assert_eq!(index.file_count(), 0);
        assert_eq!(index.import_path_count(), 0);
    }

    #[test]
    fn test_add_file_module() {
        let mut index = SymbolIndex::new();
        index.add_file_module(PathBuf::from("src/utils.rs"), "utils".to_string());
        assert_eq!(index.file_count(), 1);
        assert_eq!(index.import_path_count(), 1);
        assert!(index.resolve_import("utils", Path::new("src/main.rs")));
    }

    #[test]
    fn test_resolve_direct_import() {
        let mut index = SymbolIndex::new();
        index.add_file_module(PathBuf::from("src/utils.rs"), "utils".to_string());
        assert!(index.resolve_import("utils", Path::new("src/main.rs")));
        assert!(!index.resolve_import("nonexistent", Path::new("src/main.rs")));
    }

    #[test]
    fn test_resolve_relative_import() {
        let mut index = SymbolIndex::new();
        index.add_file_module(PathBuf::from("src/utils.rs"), "utils".to_string());

        // From src/main.rs, ./utils should resolve to src/utils.rs
        assert!(index.resolve_import("./utils", Path::new("src/main.rs")));

        // From src/sub/main.rs, ../utils should resolve to src/utils.rs
        assert!(index.resolve_import("../utils", Path::new("src/sub/main.rs")));

        // Non-existent relative import
        assert!(!index.resolve_import("./nonexistent", Path::new("src/main.rs")));
    }

    #[test]
    fn test_extract_rust_module() {
        assert_eq!(
            extract_rust_module("crates/virage-engine/src/chunkers/lang.rs"),
            Some("chunkers::lang".to_string())
        );
        assert_eq!(extract_rust_module("/src/lib.rs"), Some("".to_string()));
        assert_eq!(extract_rust_module("/src/mod.rs"), Some("".to_string()));
        assert_eq!(
            extract_rust_module("/src/foo/bar.rs"),
            Some("foo::bar".to_string())
        );
    }

    #[test]
    fn test_extract_ts_module() {
        assert_eq!(
            extract_ts_module("packages/virage-core/src/core/utils.ts"),
            Some("utils".to_string())
        );
        assert_eq!(
            extract_ts_module("packages/virage-core/src/core/utils/index.ts"),
            Some("utils".to_string())
        );
    }

    #[test]
    fn test_extract_python_module() {
        assert_eq!(
            extract_python_module("src/utils.py"),
            Some("utils".to_string())
        );
        assert_eq!(
            extract_python_module("src/pkg/__init__.py"),
            Some("pkg".to_string())
        );
    }

    #[test]
    fn test_build_symbol_index() {
        let files = vec![
            (PathBuf::from("/src/lib.rs"), "rust".to_string()),
            (PathBuf::from("/src/utils.rs"), "rust".to_string()),
            (PathBuf::from("/src/main.rs"), "rust".to_string()),
        ];
        let index = build_symbol_index(&files);
        assert_eq!(index.file_count(), 3);
        assert!(index.resolve_import("utils", Path::new("/src/main.rs")));
    }
}
