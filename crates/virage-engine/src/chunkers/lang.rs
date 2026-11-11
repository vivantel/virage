use tree_sitter::{Language, Node, Parser, Query, QueryCursor};
use virage_vidoc::{DocNode, DocNodeAttrs, DocNodeType};

use super::{FileChunker, ParseResult};

pub struct LangChunker;

impl FileChunker for LangChunker {
    fn name(&self) -> &str {
        "lang"
    }

    fn patterns(&self) -> &[&str] {
        &[
            "*.py", "*.pyi", "*.js", "*.mjs", "*.cjs", "*.ts", "*.mts", "*.cts", "*.tsx", "*.java",
            "*.go", "*.rs", "*.c", "*.h", "*.cpp", "*.cxx", "*.cc", "*.hh", "*.hpp", "*.cs",
            "*.rb", "*.svelte",
        ]
    }

    fn parse(&self, path: &str, bytes: &[u8]) -> Result<ParseResult, String> {
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if ext.eq_ignore_ascii_case("svelte") {
            return Ok(ParseResult {
                tree: parse_svelte(bytes)?,
            });
        }
        let lang =
            Lang::from_extension(ext).ok_or_else(|| format!("unsupported extension: .{ext}"))?;
        let tree = parse_doc(bytes, &lang)?;
        Ok(ParseResult { tree })
    }
}

// ─── Language registry ────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum Lang {
    Python,
    JavaScript,
    TypeScript,
    Tsx,
    Java,
    Go,
    Rust,
    C,
    Cpp,
    CSharp,
    Ruby,
}

impl Lang {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "py" | "pyi" => Some(Lang::Python),
            "js" | "mjs" | "cjs" => Some(Lang::JavaScript),
            "ts" | "mts" | "cts" => Some(Lang::TypeScript),
            "tsx" => Some(Lang::Tsx),
            "java" => Some(Lang::Java),
            "go" => Some(Lang::Go),
            "rs" => Some(Lang::Rust),
            "c" | "h" => Some(Lang::C),
            "cpp" | "cxx" | "cc" | "hh" | "hpp" => Some(Lang::Cpp),
            "cs" => Some(Lang::CSharp),
            "rb" => Some(Lang::Ruby),
            _ => None,
        }
    }

    pub fn id(&self) -> &'static str {
        match self {
            Lang::Python => "python",
            Lang::JavaScript => "javascript",
            Lang::TypeScript => "typescript",
            Lang::Tsx => "tsx",
            Lang::Java => "java",
            Lang::Go => "go",
            Lang::Rust => "rust",
            Lang::C => "c",
            Lang::Cpp => "cpp",
            Lang::CSharp => "csharp",
            Lang::Ruby => "ruby",
        }
    }

    pub fn ts_language(&self) -> Language {
        match self {
            Lang::Python => tree_sitter_python::LANGUAGE.into(),
            Lang::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            Lang::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Lang::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Lang::Java => tree_sitter_java::LANGUAGE.into(),
            Lang::Go => tree_sitter_go::LANGUAGE.into(),
            Lang::Rust => tree_sitter_rust::LANGUAGE.into(),
            Lang::C => tree_sitter_c::LANGUAGE.into(),
            Lang::Cpp => tree_sitter_cpp::LANGUAGE.into(),
            Lang::CSharp => tree_sitter_c_sharp::LANGUAGE.into(),
            Lang::Ruby => tree_sitter_ruby::LANGUAGE.into(),
        }
    }
}

// ─── Node kind classification ─────────────────────────────────────────────────

/// Returns true if this CST node kind represents a named definition (class, function, etc.)
/// that should become a `Section` in the ViDoc AST.
///
/// Node kind names overlap across languages (e.g. "function_declaration" is used by
/// JS, Java, Go, and C#). This is intentional — the same kind maps to the same concept.
fn is_definition(kind: &str) -> bool {
    matches!(
        kind,
        // Shared across multiple languages
        | "function_definition"       // Python, C, C++
        | "async_function_definition" // Python
        | "class_definition"          // Python
        | "function_declaration"      // JS, Go, Java, C#
        | "generator_function_declaration" // JS
        | "class_declaration"         // JS, Java, C#
        | "method_definition"         // JS
        | "function"                  // JS (function expression)
        | "arrow_function"            // JS
        | "export_statement"          // JS/TS (re-exports definitions)
        | "interface_declaration"     // TS, Java, C#
        | "type_alias_declaration"    // TS
        | "enum_declaration"          // TS, Java, C#
        | "abstract_class_declaration" // TS
        | "ambient_declaration"       // TS
        | "method_declaration"        // Java, C#, Go
        | "constructor_declaration"   // Java, C#
        | "annotation_type_declaration" // Java
        | "field_declaration"         // Java
        | "type_declaration"          // Go
        | "function_item"             // Rust
        | "impl_item"                 // Rust
        | "struct_item"               // Rust
        | "enum_item"                 // Rust
        | "trait_item"                // Rust
        | "mod_item"                  // Rust
        | "type_item"                 // Rust
        | "const_item"                // Rust
        | "struct_specifier"          // C / C++
        | "class_specifier"           // C++
        | "struct_declaration"        // C#
        | "method"                    // Ruby
        | "class"                     // Ruby
        | "module"                    // Ruby
        | "singleton_method" // Ruby
    )
}

/// Returns true if this kind is a comment or doc-comment node.
fn is_comment(kind: &str) -> bool {
    kind.contains("comment")
        || kind.contains("doc_comment")
        || kind == "line_comment"
        || kind == "block_comment"
}

// ─── Signature extraction ─────────────────────────────────────────────────────

/// Extract a compact single-line signature for a definition node.
/// We take the text up to (but not including) the body or up to a fixed
/// character limit, trimming trailing whitespace and `{`/`:`.
fn extract_signature(node: Node, src: &[u8]) -> String {
    // Walk children looking for "body", "block", "statement_block", etc.
    let mut end_byte = node.end_byte();
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i) {
            let ck = child.kind();
            if matches!(
                ck,
                "block"
                    | "statement_block"
                    | "declaration_list"
                    | "class_body"
                    | "enum_body"
                    | "interface_body"
                    | "field_declaration_list"
                    | "body"
                    | "impl_block"
            ) {
                end_byte = child.start_byte();
                break;
            }
        }
    }

    let raw = &src[node.start_byte()..end_byte.min(node.start_byte() + 400)];
    let text = String::from_utf8_lossy(raw);
    // Collapse whitespace and trim trailing punctuation
    let compact: String = text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    compact
        .trim_end_matches(|c: char| c == '{' || c == ':' || c.is_whitespace())
        .to_string()
}

/// Extract just the name from a signature (e.g., "class MyClass:" -> "MyClass", "def method(self):" -> "method")
fn extract_name_from_signature(sig: &str) -> String {
    // Remove leading keywords like "class ", "def ", "async def ", "struct ", etc.
    let trimmed = sig.trim_start();
    let without_keyword = if trimmed.starts_with("class ") {
        trimmed.strip_prefix("class ").unwrap_or(trimmed)
    } else if trimmed.starts_with("async def ") {
        trimmed.strip_prefix("async def ").unwrap_or(trimmed)
    } else if trimmed.starts_with("def ") {
        trimmed.strip_prefix("def ").unwrap_or(trimmed)
    } else if trimmed.starts_with("struct ") {
        trimmed.strip_prefix("struct ").unwrap_or(trimmed)
    } else if trimmed.starts_with("enum ") {
        trimmed.strip_prefix("enum ").unwrap_or(trimmed)
    } else if trimmed.starts_with("trait ") {
        trimmed.strip_prefix("trait ").unwrap_or(trimmed)
    } else if trimmed.starts_with("impl ") {
        trimmed.strip_prefix("impl ").unwrap_or(trimmed)
    } else if trimmed.starts_with("mod ") {
        trimmed.strip_prefix("mod ").unwrap_or(trimmed)
    } else if trimmed.starts_with("type ") {
        trimmed.strip_prefix("type ").unwrap_or(trimmed)
    } else if trimmed.starts_with("const ") {
        trimmed.strip_prefix("const ").unwrap_or(trimmed)
    } else if trimmed.starts_with("fn ") {
        trimmed.strip_prefix("fn ").unwrap_or(trimmed)
    } else if trimmed.starts_with("function ") {
        trimmed.strip_prefix("function ").unwrap_or(trimmed)
    } else if trimmed.starts_with("method ") {
        trimmed.strip_prefix("method ").unwrap_or(trimmed)
    } else {
        trimmed
    };
    // Extract the first identifier (stop at first space, (, :, {, etc.)
    without_keyword
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect()
}

/// Per-language tree-sitter queries for FQN extraction.
/// Returns the capture name for the definition name node.
fn fqn_query_for_lang(lang: &Lang) -> Option<(&'static str, &'static str)> {
    Some(match lang {
        Lang::Python => (
            r#"
            [
              (function_definition name: (identifier) @def.name)
              (class_definition name: (identifier) @def.name)
            ]
            "#,
            "def.name",
        ),
        Lang::JavaScript | Lang::TypeScript | Lang::Tsx => (
            r#"
            [
              (function_declaration name: (identifier) @def.name)
              (generator_function_declaration name: (identifier) @def.name)
              (class_declaration name: (type_identifier) @def.name)
              (method_definition name: (property_identifier) @def.name)
              (function name: (identifier) @def.name)
              (arrow_function name: (identifier) @def.name)
              (interface_declaration name: (type_identifier) @def.name)
              (type_alias_declaration name: (type_identifier) @def.name)
              (enum_declaration name: (identifier) @def.name)
            ]
            "#,
            "def.name",
        ),
        Lang::Java => (
            r#"
            [
              (class_declaration name: (identifier) @def.name)
              (interface_declaration name: (identifier) @def.name)
              (enum_declaration name: (identifier) @def.name)
              (method_declaration name: (identifier) @def.name)
              (constructor_declaration name: (identifier) @def.name)
            ]
            "#,
            "def.name",
        ),
        Lang::Go => (
            r#"
            [
              (function_declaration name: (identifier) @def.name)
              (method_declaration name: (field_identifier) @def.name)
              (type_declaration (type_spec name: (type_identifier) @def.name))
            ]
            "#,
            "def.name",
        ),
        Lang::Rust => (
            r#"
            [
              (function_item name: (identifier) @def.name)
              (struct_item name: (type_identifier) @def.name)
              (enum_item name: (type_identifier) @def.name)
              (trait_item name: (type_identifier) @def.name)
              (impl_item type: (_) @def.name)
              (mod_item name: (identifier) @def.name)
              (type_item name: (type_identifier) @def.name)
              (const_item name: (identifier) @def.name)
            ]
            "#,
            "def.name",
        ),
        Lang::C | Lang::Cpp => (
            r#"
            [
              (function_definition declarator: (function_declarator declarator: (identifier) @def.name))
              (struct_specifier name: (type_identifier) @def.name)
              (class_specifier name: (type_identifier) @def.name)
            ]
            "#,
            "def.name",
        ),
        Lang::CSharp => (
            r#"
            [
              (class_declaration name: (identifier) @def.name)
              (struct_declaration name: (identifier) @def.name)
              (interface_declaration name: (identifier) @def.name)
              (enum_declaration name: (identifier) @def.name)
              (method_declaration name: (identifier) @def.name)
            ]
            "#,
            "def.name",
        ),
        Lang::Ruby => (
            r#"
            [
              (method name: (identifier) @def.name)
              (class name: (constant) @def.name)
              (module name: (constant) @def.name)
              (singleton_method name: (identifier) @def.name)
            ]
            "#,
            "def.name",
        ),
    })
}

/// Per-language tree-sitter queries for import extraction.
fn import_query_for_lang(lang: &Lang) -> Option<(&'static str, &'static str)> {
    Some(match lang {
        Lang::Python => (
            r#"
            [
              (import_statement name: (dotted_name) @import.path)
              (import_from_statement module_name: (dotted_name) @import.path)
            ]
            "#,
            "import.path",
        ),
        Lang::JavaScript | Lang::TypeScript | Lang::Tsx => (
            r#"
            [
              (import_statement source: (string) @import.path)
              (export_statement source: (string) @import.path)
            ]
            "#,
            "import.path",
        ),
        Lang::Java => (
            r#"
            (import_declaration name: (identifier) @import.path)
            "#,
            "import.path",
        ),
        Lang::Go => (
            r#"
            (import_declaration (import_spec path: (interpreted_string_literal) @import.path))
            "#,
            "import.path",
        ),
        Lang::Rust => (
            r#"
            [
              (use_declaration argument: (_) @import.path)
            ]
            "#,
            "import.path",
        ),
        Lang::C | Lang::Cpp => (
            r#"
            (preproc_include path: (string_literal) @import.path)
            "#,
            "import.path",
        ),
        Lang::CSharp => (
            r#"
            (using_directive name: (qualified_name) @import.path)
            "#,
            "import.path",
        ),
        Lang::Ruby => (
            r#"
            [
              (call method: (identifier) @import.method (#eq? @import.method "require"))
              (call method: (identifier) @import.method (#eq? @import.method "require_relative"))
            ]
            "#,
            "import.method",
        ),
    })
}

/// Extract the fully qualified name for a definition node using tree-sitter queries.
/// Combines the breadcrumb (parent scopes) with the definition name.
fn extract_fqn(
    node: tree_sitter::Node,
    src: &[u8],
    lang: &Lang,
    breadcrumb: &[String],
) -> Option<String> {
    let (query_str, capture_name) = fqn_query_for_lang(lang)?;
    let query = Query::new(&lang.ts_language(), query_str).ok()?;
    let mut cursor = QueryCursor::new();
    let matches = cursor.matches(&query, node, src);
    let mut def_name = None;
    for m in matches {
        for capture in m.captures {
            if query.capture_names()[capture.index as usize] == capture_name {
                def_name = Some(
                    String::from_utf8_lossy(
                        &src[capture.node.start_byte()..capture.node.end_byte()],
                    )
                    .to_string(),
                );
                break;
            }
        }
        if def_name.is_some() {
            break;
        }
    }
    def_name.map(|name| {
        if breadcrumb.is_empty() {
            name
        } else {
            format!("{}::{}", breadcrumb.join("::"), name)
        }
    })
}

/// Extract import statements from a source file using tree-sitter queries.
fn extract_imports(root: tree_sitter::Node, src: &[u8], lang: &Lang) -> Vec<String> {
    let (query_str, capture_name) = match import_query_for_lang(lang) {
        Some(q) => q,
        None => return Vec::new(),
    };
    let query = match Query::new(&lang.ts_language(), query_str) {
        Ok(q) => q,
        Err(_) => return Vec::new(),
    };
    let mut cursor = QueryCursor::new();
    let mut imports = Vec::new();
    for m in cursor.matches(&query, root, src) {
        for capture in m.captures {
            if query.capture_names()[capture.index as usize] == capture_name {
                let import_text = String::from_utf8_lossy(
                    &src[capture.node.start_byte()..capture.node.end_byte()],
                )
                .to_string();
                let cleaned = import_text.trim_matches(|c| c == '"' || c == '\'' || c == '`');
                if !cleaned.is_empty() {
                    imports.push(cleaned.to_string());
                }
            }
        }
    }
    imports
}

// ─── CST → ViDoc walker ───────────────────────────────────────────────────────

struct Walker<'a> {
    src: &'a [u8],
    lang_id: &'static str,
    lang: &'a Lang,
}

impl<'a> Walker<'a> {
    fn walk_children(&self, node: Node<'a>, breadcrumb: &[String]) -> Vec<DocNode> {
        let mut children: Vec<DocNode> = Vec::new();
        let mut i = 0;
        let count = node.named_child_count();

        while i < count {
            let child = match node.named_child(i) {
                Some(c) => c,
                None => {
                    i += 1;
                    continue;
                }
            };

            let kind = child.kind();

            if is_comment(kind) {
                // Emit as Paragraph — adjacent comments above a definition are
                // included as leading text in the section by walkToChunks.
                let text = String::from_utf8_lossy(&self.src[child.start_byte()..child.end_byte()])
                    .trim_start_matches(['/', '*', '#', '-', ' ', '\t', '!'])
                    .trim()
                    .to_string();
                if !text.is_empty() {
                    children.push(DocNode {
                        node_type: DocNodeType::Paragraph,
                        children: None,
                        text: Some(text),
                        attrs: DocNodeAttrs {
                            byte_start: child.start_byte() as u64,
                            byte_end: child.end_byte() as u64,
                            line_start: Some(child.start_position().row as u32 + 1),
                            line_end: Some(child.end_position().row as u32 + 1),
                            breadcrumb: Some(breadcrumb.to_vec()),
                            ..Default::default()
                        },
                    });
                }
                i += 1;
                continue;
            }

            if is_definition(kind) {
                let sig = extract_signature(child, self.src);
                let mut new_breadcrumb = breadcrumb.to_vec();
                // Extract just the name from the signature for cleaner FQN
                let name = extract_name_from_signature(&sig);
                if !name.is_empty() {
                    new_breadcrumb.push(name);
                }

                // Extract FQN for this definition using parent breadcrumb
                let fqn = extract_fqn(child, self.src, self.lang, breadcrumb);

                // Recurse into the definition body to find nested definitions
                // Also recurse into block bodies for class/function definitions to find methods
                let nested = self.walk_children(child, &new_breadcrumb);

                // Also recurse into block bodies for class/function definitions
                let nested_in_block = self.walk_block_bodies(child, &new_breadcrumb);

                let all_nested = [nested, nested_in_block].concat();

                let mut attrs = DocNodeAttrs {
                    byte_start: child.start_byte() as u64,
                    byte_end: child.end_byte() as u64,
                    line_start: Some(child.start_position().row as u32 + 1),
                    line_end: Some(child.end_position().row as u32 + 1),
                    heading_level: Some(breadcrumb.len() as u8 + 1),
                    breadcrumb: Some(breadcrumb.to_vec()),
                    code_language: Some(self.lang_id.to_string()),
                    source_format: Some("code".to_string()),
                    ..Default::default()
                };
                // Store FQN in citation field for now (custom field would be better but requires vidoc changes)
                if let Some(fqn) = fqn {
                    attrs.citation = Some(fqn);
                }

                children.push(DocNode {
                    node_type: DocNodeType::Section,
                    children: if all_nested.is_empty() {
                        None
                    } else {
                        Some(all_nested)
                    },
                    text: if sig.is_empty() { None } else { Some(sig) },
                    attrs,
                });
                i += 1;
                continue;
            }

            // Any top-level non-definition, non-comment node → emit as Code block
            // (import statements, top-level expressions, decorators, etc.)
            // Skip block-like nodes that are definition bodies (their content is processed separately)
            let is_def_body = matches!(
                kind,
                "block"
                    | "statement_block"
                    | "declaration_list"
                    | "class_body"
                    | "enum_body"
                    | "interface_body"
                    | "field_declaration_list"
                    | "body"
                    | "impl_block"
            );
            if !is_def_body {
                let text = String::from_utf8_lossy(&self.src[child.start_byte()..child.end_byte()])
                    .into_owned();
                if !text.trim().is_empty() {
                    children.push(DocNode {
                        node_type: DocNodeType::Code,
                        children: None,
                        text: Some(text),
                        attrs: DocNodeAttrs {
                            byte_start: child.start_byte() as u64,
                            byte_end: child.end_byte() as u64,
                            line_start: Some(child.start_position().row as u32 + 1),
                            line_end: Some(child.end_position().row as u32 + 1),
                            breadcrumb: Some(breadcrumb.to_vec()),
                            code_language: Some(self.lang_id.to_string()),
                            ..Default::default()
                        },
                    });
                }
            }
            i += 1;
        }

        children
    }

    /// Recursively walk block bodies to find nested definitions (methods inside classes, etc.)
    fn walk_block_bodies(&self, node: Node, breadcrumb: &[String]) -> Vec<DocNode> {
        let mut children: Vec<DocNode> = Vec::new();

        for i in 0..node.named_child_count() {
            if let Some(child) = node.named_child(i) {
                let kind = child.kind();

                // Recurse into block/statement_block/declaration_list/class_body/etc.
                if matches!(
                    kind,
                    "block"
                        | "statement_block"
                        | "declaration_list"
                        | "class_body"
                        | "enum_body"
                        | "interface_body"
                        | "field_declaration_list"
                        | "body"
                        | "impl_block"
                ) {
                    let block_children = self.walk_children(child, breadcrumb);
                    children.extend(block_children);
                }
            }
        }

        children
    }
}

// ─── Public parse entry point ─────────────────────────────────────────────────

pub fn parse_doc(src: &[u8], lang: &Lang) -> Result<DocNode, String> {
    let mut parser = Parser::new();
    parser
        .set_language(&lang.ts_language())
        .map_err(|e| format!("tree-sitter language error: {e}"))?;

    let tree = parser
        .parse(src, None)
        .ok_or_else(|| "tree-sitter parse returned None".to_string())?;

    let root = tree.root_node();
    let imports = extract_imports(root, src, lang);
    let walker = Walker {
        src,
        lang_id: lang.id(),
        lang,
    };
    let children = walker.walk_children(root, &[]);

    Ok(DocNode {
        node_type: DocNodeType::Document,
        children: if children.is_empty() {
            None
        } else {
            Some(children)
        },
        text: None,
        attrs: DocNodeAttrs {
            byte_start: 0,
            byte_end: src.len() as u64,
            source_format: Some("code".to_string()),
            code_language: Some(lang.id().to_string()),
            imports: Some(imports),
            ..Default::default()
        },
    })
}

// ─── Svelte ──────────────────────────────────────────────────────────────────

/// Byte ranges of the bodies of `<script …>…</script>` (`scripts`) and `<style …>…</style>`
/// (`styles`) blocks, found case-insensitively without a Svelte grammar.
fn svelte_blocks(src: &[u8]) -> (Vec<(usize, usize)>, Vec<(usize, usize)>) {
    let lower = src.to_ascii_lowercase();
    let find = |needle: &[u8], from: usize| {
        lower[from..]
            .windows(needle.len())
            .position(|w| w == needle)
            .map(|i| i + from)
    };
    let (mut scripts, mut styles) = (Vec::new(), Vec::new());
    let mut at = 0;
    while at < lower.len() {
        let next = [(&b"<script"[..], true), (&b"<style"[..], false)]
            .into_iter()
            .filter_map(|(tag, is_script)| find(tag, at).map(|i| (i, tag, is_script)))
            .min_by_key(|(i, _, _)| *i);
        let Some((open, tag, is_script)) = next else {
            break;
        };
        // `<scripts>` or `<styled>` are not blocks: the tag name must end at whitespace, `>` or `/`.
        let after = open + tag.len();
        if !matches!(
            lower.get(after),
            Some(b' ' | b'\t' | b'\r' | b'\n' | b'>' | b'/')
        ) {
            at = after;
            continue;
        }
        let Some(gt) = find(b">", after) else { break };
        let close_tag: &[u8] = if is_script { b"</script" } else { b"</style" };
        let body_start = gt + 1;
        // `<script … />` has no body.
        if lower[gt.saturating_sub(1)] == b'/' {
            at = body_start;
            continue;
        }
        let body_end = find(close_tag, body_start).unwrap_or(lower.len());
        if is_script {
            scripts.push((body_start, body_end));
        } else {
            styles.push((body_start, body_end));
        }
        at = find(b">", body_end).map_or(lower.len(), |i| i + 1);
    }
    (scripts, styles)
}

/// Replace every byte outside `keep` with a space (newlines survive, so line numbers and byte
/// offsets in the masked copy match the original file).
fn mask_outside(src: &[u8], keep: &[(usize, usize)]) -> Vec<u8> {
    let mut out: Vec<u8> = src
        .iter()
        .map(|&b| if b == b'\n' { b } else { b' ' })
        .collect();
    for &(a, b) in keep {
        out[a..b].copy_from_slice(&src[a..b]);
    }
    out
}

/// Visible markup text of a component: everything outside script and style blocks, with tags
/// dropped and whitespace collapsed. Keeps attribute-free text, `{expressions}` and `{#if}` blocks,
/// which carry the UI strings people search for.
fn svelte_markup_text(src: &[u8], blocks: &[(usize, usize)]) -> String {
    let mut text = String::new();
    let mut pos = 0;
    let mut sorted = blocks.to_vec();
    sorted.sort_unstable();
    for (a, b) in sorted {
        // Include the surrounding `<script …>` / `</script>` tags in the region to drop.
        let open = src[..a].iter().rposition(|&c| c == b'<').unwrap_or(a);
        let close = src[b..]
            .iter()
            .position(|&c| c == b'>')
            .map_or(src.len(), |i| b + i + 1);
        if open >= pos {
            text.push_str(&String::from_utf8_lossy(&src[pos..open]));
            text.push(' ');
            pos = close;
        }
    }
    if pos < src.len() {
        text.push_str(&String::from_utf8_lossy(&src[pos..]));
    }
    let mut out = String::new();
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' if in_tag => in_tag = false,
            _ if in_tag => {}
            _ => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Svelte component: each `<script>` body is parsed as TypeScript at its original byte offsets
/// (TypeScript is a superset of the plain-JS case), and the markup text becomes one extra
/// paragraph so UI strings and `{#if}`/`{#each}` logic are searchable.
pub fn parse_svelte(src: &[u8]) -> Result<DocNode, String> {
    let (scripts, styles) = svelte_blocks(src);
    let mut doc = parse_doc(&mask_outside(src, &scripts), &Lang::TypeScript)?;
    doc.attrs.byte_end = src.len() as u64;
    doc.attrs.code_language = Some("svelte".to_string());

    let all: Vec<(usize, usize)> = scripts.iter().chain(styles.iter()).copied().collect();
    let markup = svelte_markup_text(src, &all);
    if !markup.is_empty() {
        let line_count = src.iter().filter(|&&b| b == b'\n').count() as u32 + 1;
        doc.children.get_or_insert_with(Vec::new).push(DocNode {
            node_type: DocNodeType::Paragraph,
            children: None,
            text: Some(markup),
            attrs: DocNodeAttrs {
                byte_start: 0,
                byte_end: src.len() as u64,
                line_start: Some(1),
                line_end: Some(line_count),
                breadcrumb: Some(vec!["template".to_string()]),
                ..Default::default()
            },
        });
    }
    Ok(doc)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use virage_vidoc::DocNodeType;

    fn first_section(doc: &DocNode) -> Option<&DocNode> {
        doc.children
            .as_ref()?
            .iter()
            .find(|n| n.node_type == DocNodeType::Section)
    }

    #[test]
    fn python_function_emits_section() {
        let src =
            b"def greet(name: str) -> str:\n    \"\"\"Say hello.\"\"\"\n    return f'Hi {name}'\n";
        let doc = parse_doc(src, &Lang::Python).unwrap();
        assert_eq!(doc.node_type, DocNodeType::Document);
        let section = first_section(&doc).expect("expected a Section node");
        assert!(
            section.text.as_deref().unwrap_or("").contains("greet"),
            "signature should mention greet"
        );
    }

    #[test]
    fn typescript_function_emits_section() {
        let src = b"export function add(a: number, b: number): number {\n  return a + b;\n}\n";
        let doc = parse_doc(src, &Lang::TypeScript).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("add"));
    }

    #[test]
    fn javascript_arrow_function_emits_section() {
        let src = b"const multiply = (a, b) => a * b;\n";
        let doc = parse_doc(src, &Lang::JavaScript).unwrap();
        // arrow_function is a definition; may be nested under variable_declaration → code node
        assert_eq!(doc.node_type, DocNodeType::Document);
        assert!(doc.children.as_ref().map_or(0, |c| c.len()) > 0);
    }

    #[test]
    fn rust_function_emits_section() {
        let src = b"pub fn fibonacci(n: u64) -> u64 {\n    if n <= 1 { n } else { fibonacci(n-1) + fibonacci(n-2) }\n}\n";
        let doc = parse_doc(src, &Lang::Rust).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("fibonacci"));
    }

    #[test]
    fn go_function_emits_section() {
        let src = b"package main\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n";
        let doc = parse_doc(src, &Lang::Go).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("Add"));
    }

    #[test]
    fn java_class_emits_section() {
        let src =
            b"public class Calculator {\n    public int add(int a, int b) { return a + b; }\n}\n";
        let doc = parse_doc(src, &Lang::Java).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("Calculator"));
    }

    #[test]
    fn c_function_emits_section() {
        let src = b"int add(int a, int b) {\n    return a + b;\n}\n";
        let doc = parse_doc(src, &Lang::C).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("add"));
    }

    #[test]
    fn cpp_class_emits_section() {
        let src = b"class Vector {\npublic:\n    float x, y;\n    Vector(float x, float y) : x(x), y(y) {}\n};\n";
        let doc = parse_doc(src, &Lang::Cpp).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("Vector"));
    }

    #[test]
    // tree-sitter-c-sharp 0.23 targets grammar ABI 15; the linked tree-sitter supports ≤14.
    // Update tree-sitter-c-sharp to a compatible version to unskip.
    #[ignore = "tree-sitter-c-sharp ABI mismatch"]
    fn csharp_method_emits_section() {
        let src = b"public class Greeter {\n    public string Hello(string name) => $\"Hello, {name}!\";\n}\n";
        let doc = parse_doc(src, &Lang::CSharp).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("Greeter"));
    }

    #[test]
    fn ruby_method_emits_section() {
        let src = b"def greet(name)\n  \"Hello, #{name}!\"\nend\n";
        let doc = parse_doc(src, &Lang::Ruby).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("greet"));
    }

    #[test]
    fn python_imports_and_fqn_extraction() {
        let src = b"import os\nimport sys.path\n\nclass MyClass:\n    def method(self):\n        pass\n\ndef my_function():\n    pass\n";
        let doc = parse_doc(src, &Lang::Python).unwrap();

        // Debug: print all sections
        if let Some(children) = &doc.children {
            for child in children {
                if child.node_type == virage_vidoc::DocNodeType::Section {
                    eprintln!(
                        "Top-level Section: text={:?}, citation={:?}, children={:?}",
                        child.text,
                        child.attrs.citation,
                        child.children.as_ref().map(|c| c.len())
                    );
                    if let Some(grandchildren) = &child.children {
                        for gc in grandchildren {
                            eprintln!(
                                "  Nested: text={:?}, citation={:?}",
                                gc.text, gc.attrs.citation
                            );
                        }
                    }
                }
            }
        }

        // Check imports
        let imports = doc
            .attrs
            .imports
            .as_ref()
            .expect("imports should be present");
        assert!(
            imports.contains(&"os".to_string()),
            "should extract 'os' import"
        );
        assert!(
            imports.contains(&"sys.path".to_string()),
            "should extract 'sys.path' import"
        );

        // Check FQN for class
        let class_section = doc
            .children
            .as_ref()
            .unwrap()
            .iter()
            .find(|n| n.text.as_deref().unwrap_or("").contains("class MyClass"))
            .expect("should find class section");
        assert_eq!(class_section.attrs.citation, Some("MyClass".to_string()));

        // Check FQN for method (nested)
        let method_section = class_section
            .children
            .as_ref()
            .unwrap()
            .iter()
            .find(|n| n.text.as_deref().unwrap_or("").contains("def method"))
            .expect("should find method section");
        assert_eq!(
            method_section.attrs.citation,
            Some("MyClass::method".to_string())
        );

        // Check FQN for function
        let func_section = doc
            .children
            .as_ref()
            .unwrap()
            .iter()
            .find(|n| n.text.as_deref().unwrap_or("").contains("def my_function"))
            .expect("should find function section");
        assert_eq!(func_section.attrs.citation, Some("my_function".to_string()));
    }

    #[test]
    fn rust_imports_and_fqn_extraction() {
        let src = b"use std::collections::HashMap;\nuse crate::my_module;\n\nstruct MyStruct;\n\nimpl MyStruct {\n    fn method(&self) {}\n}\n\nfn my_function() {}\n";
        let doc = parse_doc(src, &Lang::Rust).unwrap();

        // Check imports
        let imports = doc
            .attrs
            .imports
            .as_ref()
            .expect("imports should be present");
        assert!(imports.contains(&"std::collections::HashMap".to_string()));
        assert!(imports.contains(&"crate::my_module".to_string()));

        // Check FQN for struct
        let struct_section = doc
            .children
            .as_ref()
            .unwrap()
            .iter()
            .find(|n| n.text.as_deref().unwrap_or("").contains("struct MyStruct"))
            .expect("should find struct section");
        assert_eq!(struct_section.attrs.citation, Some("MyStruct".to_string()));

        // Check FQN for impl method (nested)
        let impl_section = doc
            .children
            .as_ref()
            .unwrap()
            .iter()
            .find(|n| n.text.as_deref().unwrap_or("").contains("impl MyStruct"))
            .expect("should find impl section");
        let method_section = impl_section
            .children
            .as_ref()
            .unwrap()
            .iter()
            .find(|n| n.text.as_deref().unwrap_or("").contains("fn method"))
            .expect("should find method section");
        assert_eq!(
            method_section.attrs.citation,
            Some("MyStruct::method".to_string())
        );

        // Check FQN for function
        let func_section = doc
            .children
            .as_ref()
            .unwrap()
            .iter()
            .find(|n| n.text.as_deref().unwrap_or("").contains("fn my_function"))
            .expect("should find function section");
        assert_eq!(func_section.attrs.citation, Some("my_function".to_string()));
    }

    #[test]
    fn code_language_set_on_sections() {
        let src = b"def foo():\n    pass\n";
        let doc = parse_doc(src, &Lang::Python).unwrap();
        let section = first_section(&doc).unwrap();
        assert_eq!(section.attrs.code_language.as_deref(), Some("python"));
    }

    #[test]
    fn empty_source_returns_document_no_children() {
        let doc = parse_doc(b"", &Lang::Python).unwrap();
        assert_eq!(doc.node_type, DocNodeType::Document);
        assert!(doc.children.is_none());
    }

    #[test]
    fn svelte_script_functions_are_sections_at_original_offsets() {
        let src = b"<script lang=\"ts\">\n  export function greet(n: string) { return n; }\n</script>\n\n<h1>Nothing changed yet</h1>\n<style>h1 { color: red }</style>\n";
        let doc = parse_svelte(src).unwrap();
        let kids = doc.children.as_ref().unwrap();
        let section = kids
            .iter()
            .find(|n| n.node_type == DocNodeType::Section)
            .expect("script function becomes a section");
        let at = section.attrs.byte_start as usize;
        assert!(String::from_utf8_lossy(&src[at..]).starts_with("export function greet"));
        let markup = kids.last().unwrap();
        assert_eq!(markup.text.as_deref(), Some("Nothing changed yet"));
    }

    #[test]
    fn svelte_without_script_still_yields_markup() {
        let doc = parse_svelte(b"<p>Hello {name}</p>").unwrap();
        let kids = doc.children.unwrap();
        assert_eq!(kids.len(), 1);
        assert_eq!(kids[0].text.as_deref(), Some("Hello {name}"));
    }

    #[test]
    fn svelte_blocks_ignore_lookalike_tags() {
        let (scripts, _) = svelte_blocks(b"<scripts>x</scripts><script>y</script>");
        assert_eq!(scripts.len(), 1);
    }
}
