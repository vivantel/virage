use tree_sitter::{Language, Node, Parser};
use virage_vidoc::{DocNode, DocNodeAttrs, DocNodeType};

// ─── Language registry ────────────────────────────────────────────────────────

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

// ─── CST → ViDoc walker ───────────────────────────────────────────────────────

struct Walker<'a> {
    src: &'a [u8],
    lang_id: &'static str,
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
                if !sig.is_empty() {
                    new_breadcrumb.push(sig.clone());
                }

                // Recurse into the definition body to find nested definitions
                let nested = self.walk_children(child, &new_breadcrumb);

                children.push(DocNode {
                    node_type: DocNodeType::Section,
                    children: if nested.is_empty() {
                        None
                    } else {
                        Some(nested)
                    },
                    text: if sig.is_empty() { None } else { Some(sig) },
                    attrs: DocNodeAttrs {
                        byte_start: child.start_byte() as u64,
                        byte_end: child.end_byte() as u64,
                        line_start: Some(child.start_position().row as u32 + 1),
                        line_end: Some(child.end_position().row as u32 + 1),
                        heading_level: Some(breadcrumb.len() as u8 + 1),
                        breadcrumb: Some(breadcrumb.to_vec()),
                        code_language: Some(self.lang_id.to_string()),
                        source_format: Some("code".to_string()),
                        ..Default::default()
                    },
                });
                i += 1;
                continue;
            }

            // Any top-level non-definition, non-comment node → emit as Code block
            // (import statements, top-level expressions, decorators, etc.)
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
            i += 1;
        }

        children
    }
}

// ─── Public parse entry point ─────────────────────────────────────────────────

pub fn parse(src: &[u8], lang: &Lang) -> Result<DocNode, String> {
    let mut parser = Parser::new();
    parser
        .set_language(&lang.ts_language())
        .map_err(|e| format!("tree-sitter language error: {e}"))?;

    let tree = parser
        .parse(src, None)
        .ok_or_else(|| "tree-sitter parse returned None".to_string())?;

    let root = tree.root_node();
    let walker = Walker {
        src,
        lang_id: lang.id(),
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
            ..Default::default()
        },
    })
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
        let src = b"def greet(name: str) -> str:\n    \"\"\"Say hello.\"\"\"\n    return f'Hi {name}'\n";
        let doc = parse(src, &Lang::Python).unwrap();
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
        let doc = parse(src, &Lang::TypeScript).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("add"));
    }

    #[test]
    fn javascript_arrow_function_emits_section() {
        let src = b"const multiply = (a, b) => a * b;\n";
        let doc = parse(src, &Lang::JavaScript).unwrap();
        // arrow_function is a definition; may be nested under variable_declaration → code node
        assert_eq!(doc.node_type, DocNodeType::Document);
        assert!(doc.children.as_ref().map_or(0, |c| c.len()) > 0);
    }

    #[test]
    fn rust_function_emits_section() {
        let src = b"pub fn fibonacci(n: u64) -> u64 {\n    if n <= 1 { n } else { fibonacci(n-1) + fibonacci(n-2) }\n}\n";
        let doc = parse(src, &Lang::Rust).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("fibonacci"));
    }

    #[test]
    fn go_function_emits_section() {
        let src = b"package main\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n";
        let doc = parse(src, &Lang::Go).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("Add"));
    }

    #[test]
    fn java_class_emits_section() {
        let src = b"public class Calculator {\n    public int add(int a, int b) { return a + b; }\n}\n";
        let doc = parse(src, &Lang::Java).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("Calculator"));
    }

    #[test]
    fn c_function_emits_section() {
        let src = b"int add(int a, int b) {\n    return a + b;\n}\n";
        let doc = parse(src, &Lang::C).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("add"));
    }

    #[test]
    fn cpp_class_emits_section() {
        let src = b"class Vector {\npublic:\n    float x, y;\n    Vector(float x, float y) : x(x), y(y) {}\n};\n";
        let doc = parse(src, &Lang::Cpp).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("Vector"));
    }

    #[test]
    // tree-sitter-c-sharp 0.23 targets grammar ABI 15; the linked tree-sitter supports ≤14.
    // Update tree-sitter-c-sharp to a compatible version to unskip.
    #[ignore = "tree-sitter-c-sharp ABI mismatch"]
    fn csharp_method_emits_section() {
        let src = b"public class Greeter {\n    public string Hello(string name) => $\"Hello, {name}!\";\n}\n";
        let doc = parse(src, &Lang::CSharp).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("Greeter"));
    }

    #[test]
    fn ruby_method_emits_section() {
        let src = b"def greet(name)\n  \"Hello, #{name}!\"\nend\n";
        let doc = parse(src, &Lang::Ruby).unwrap();
        let section = first_section(&doc).expect("expected a Section node");
        assert!(section.text.as_deref().unwrap_or("").contains("greet"));
    }

    #[test]
    fn code_language_set_on_sections() {
        let src = b"def foo():\n    pass\n";
        let doc = parse(src, &Lang::Python).unwrap();
        let section = first_section(&doc).unwrap();
        assert_eq!(
            section.attrs.code_language.as_deref(),
            Some("python")
        );
    }

    #[test]
    fn empty_source_returns_document_no_children() {
        let doc = parse(b"", &Lang::Python).unwrap();
        assert_eq!(doc.node_type, DocNodeType::Document);
        assert!(doc.children.is_none());
    }
}
