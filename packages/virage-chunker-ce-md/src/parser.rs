use comrak::{
    nodes::{AstNode, ListType, NodeValue},
    parse_document, Arena, Options,
};
use virage_vidoc::{DocNode, DocNodeAttrs, DocNodeType};

pub fn parse(src: &str) -> Result<DocNode, Box<dyn std::error::Error>> {
    let mut opts = Options::default();
    opts.extension.strikethrough = true;
    opts.extension.table = true;
    opts.extension.tasklist = true;
    opts.extension.autolink = true;
    // Comrak handles YAML front matter; it becomes a FrontMatter node we skip.
    opts.extension.front_matter_delimiter = Some("---".to_owned());

    let arena = Arena::new();
    let root = parse_document(&arena, src, &opts);
    let line_offsets = build_line_offsets(src);

    let children = walk_block_children(root, &line_offsets, 0);

    Ok(DocNode {
        node_type: DocNodeType::Document,
        children: Some(children),
        text: None,
        attrs: DocNodeAttrs {
            byte_start: 0,
            byte_end: src.len() as u64,
            source_format: Some("md".to_string()),
            ..Default::default()
        },
    })
}

/// Precompute the byte offset of each line's first byte (0-indexed by line-1).
fn build_line_offsets(src: &str) -> Vec<usize> {
    let mut offsets = vec![0usize];
    for (i, b) in src.bytes().enumerate() {
        if b == b'\n' {
            offsets.push(i + 1);
        }
    }
    offsets
}

/// Convert a 1-based (line, col) sourcepos start to a byte offset.
/// Columns are UTF-8 byte offsets within the line (comrak default).
fn byte_start(line: usize, col: usize, offsets: &[usize]) -> u64 {
    let line_base = offsets.get(line.saturating_sub(1)).copied().unwrap_or(0);
    (line_base + col.saturating_sub(1)) as u64
}

/// Convert a 1-based (line, col) sourcepos end (inclusive) to an exclusive byte offset.
fn byte_end(line: usize, col: usize, offsets: &[usize]) -> u64 {
    let line_base = offsets.get(line.saturating_sub(1)).copied().unwrap_or(0);
    (line_base + col) as u64
}

fn node_range<'a>(node: &'a AstNode<'a>, offsets: &[usize]) -> (u64, u64) {
    let ast = node.data.borrow();
    let sp = ast.sourcepos;
    (
        byte_start(sp.start.line, sp.start.column, offsets),
        byte_end(sp.end.line, sp.end.column, offsets),
    )
}

fn walk_block_children<'a>(
    parent: &'a AstNode<'a>,
    offsets: &[usize],
    list_depth: u32,
) -> Vec<DocNode> {
    parent
        .children()
        .filter_map(|child| walk_node(child, offsets, list_depth))
        .collect()
}

fn walk_node<'a>(node: &'a AstNode<'a>, offsets: &[usize], list_depth: u32) -> Option<DocNode> {
    let (bs, be) = node_range(node, offsets);

    // Clone only the parts we need before recursing (avoids holding RefCell borrow).
    let val = node.data.borrow().value.clone();

    match val {
        NodeValue::FrontMatter(_) => None,

        NodeValue::Heading(h) => {
            let text = collect_text(node);
            if text.is_empty() {
                return None;
            }
            Some(DocNode {
                node_type: DocNodeType::Heading,
                children: None,
                text: Some(text),
                attrs: DocNodeAttrs {
                    heading_level: Some(h.level),
                    byte_start: bs,
                    byte_end: be,
                    ..Default::default()
                },
            })
        }

        NodeValue::Paragraph => {
            let text = collect_text(node);
            if text.is_empty() {
                return None;
            }
            Some(DocNode {
                node_type: DocNodeType::Paragraph,
                children: None,
                text: Some(text),
                attrs: DocNodeAttrs {
                    byte_start: bs,
                    byte_end: be,
                    ..Default::default()
                },
            })
        }

        NodeValue::CodeBlock(cb) => {
            let lang = cb.info.split_whitespace().next().map(str::to_owned);
            let text = cb.literal.trim_end().to_owned();
            Some(DocNode {
                node_type: DocNodeType::Code,
                children: None,
                text: if text.is_empty() { None } else { Some(text) },
                attrs: DocNodeAttrs {
                    code_language: lang,
                    byte_start: bs,
                    byte_end: be,
                    ..Default::default()
                },
            })
        }

        NodeValue::BlockQuote => {
            let children = walk_block_children(node, offsets, list_depth);
            Some(DocNode {
                node_type: DocNodeType::Section,
                children: Some(children),
                text: None,
                attrs: DocNodeAttrs {
                    byte_start: bs,
                    byte_end: be,
                    ..Default::default()
                },
            })
        }

        NodeValue::List(list) => {
            let ordered = list.list_type == ListType::Ordered;
            let children = walk_block_children(node, offsets, list_depth + 1);
            if children.is_empty() {
                return None;
            }
            Some(DocNode {
                node_type: DocNodeType::List,
                children: Some(children),
                text: None,
                attrs: DocNodeAttrs {
                    ordered: Some(ordered),
                    list_depth: Some(list_depth),
                    byte_start: bs,
                    byte_end: be,
                    ..Default::default()
                },
            })
        }

        NodeValue::Item(_) => {
            let text = collect_item_text(node);
            // Collect nested lists as children.
            let nested: Vec<DocNode> = node
                .children()
                .filter_map(|child| {
                    if matches!(child.data.borrow().value, NodeValue::List(_)) {
                        walk_node(child, offsets, list_depth + 1)
                    } else {
                        None
                    }
                })
                .collect();
            Some(DocNode {
                node_type: DocNodeType::ListItem,
                children: if nested.is_empty() {
                    None
                } else {
                    Some(nested)
                },
                text: if text.is_empty() { None } else { Some(text) },
                attrs: DocNodeAttrs {
                    list_depth: Some(list_depth),
                    byte_start: bs,
                    byte_end: be,
                    ..Default::default()
                },
            })
        }

        NodeValue::Table(_) => {
            let children = walk_table_children(node, offsets);
            if children.is_empty() {
                return None;
            }
            Some(DocNode {
                node_type: DocNodeType::Table,
                children: Some(children),
                text: None,
                attrs: DocNodeAttrs {
                    byte_start: bs,
                    byte_end: be,
                    ..Default::default()
                },
            })
        }

        // Skip structural nodes we don't map
        NodeValue::ThematicBreak | NodeValue::HtmlBlock(_) | NodeValue::FootnoteDefinition(_) => {
            None
        }

        // Document root only appears at the top level; skip if encountered in recursion.
        NodeValue::Document => None,

        // Everything else: recurse into children as a section.
        _ => {
            let children = walk_block_children(node, offsets, list_depth);
            if children.is_empty() {
                None
            } else {
                Some(DocNode {
                    node_type: DocNodeType::Section,
                    children: Some(children),
                    text: None,
                    attrs: DocNodeAttrs {
                        byte_start: bs,
                        byte_end: be,
                        ..Default::default()
                    },
                })
            }
        }
    }
}

fn walk_table_children<'a>(table: &'a AstNode<'a>, offsets: &[usize]) -> Vec<DocNode> {
    let mut rows = Vec::new();
    for (row_idx, row_node) in table.children().enumerate() {
        let row_val = row_node.data.borrow().value.clone();
        if let NodeValue::TableRow(is_header) = row_val {
            let (row_bs, row_be) = node_range(row_node, offsets);
            let cells: Vec<DocNode> = row_node
                .children()
                .enumerate()
                .map(|(col_idx, cell)| {
                    let (cell_bs, cell_be) = node_range(cell, offsets);
                    let text = collect_text(cell);
                    DocNode {
                        node_type: DocNodeType::TableCell,
                        children: None,
                        text: if text.is_empty() { None } else { Some(text) },
                        attrs: DocNodeAttrs {
                            table_row: Some(row_idx as u32),
                            table_col: Some(col_idx as u32),
                            is_header: if is_header { Some(true) } else { None },
                            byte_start: cell_bs,
                            byte_end: cell_be,
                            ..Default::default()
                        },
                    }
                })
                .collect();
            rows.push(DocNode {
                node_type: DocNodeType::TableRow,
                children: Some(cells),
                text: None,
                attrs: DocNodeAttrs {
                    table_row: Some(row_idx as u32),
                    is_header: if is_header { Some(true) } else { None },
                    byte_start: row_bs,
                    byte_end: row_be,
                    ..Default::default()
                },
            });
        }
    }
    rows
}

/// Collect the text content of a list item (from its first Paragraph child).
fn collect_item_text<'a>(item: &'a AstNode<'a>) -> String {
    for child in item.children() {
        let val = child.data.borrow().value.clone();
        if matches!(val, NodeValue::Paragraph) {
            return collect_text(child);
        }
    }
    String::new()
}

/// Recursively collect inline text from a node's descendant inline nodes.
fn collect_text<'a>(node: &'a AstNode<'a>) -> String {
    let mut buf = String::new();
    collect_text_inner(node, &mut buf);
    buf.trim().to_owned()
}

fn collect_text_inner<'a>(node: &'a AstNode<'a>, buf: &mut String) {
    let val = node.data.borrow().value.clone();
    match val {
        NodeValue::Text(ref t) => {
            buf.push_str(t.as_ref());
            return;
        }
        NodeValue::Code(ref c) => {
            buf.push_str(&c.literal);
            return;
        }
        NodeValue::SoftBreak => {
            buf.push(' ');
            return;
        }
        NodeValue::LineBreak => {
            buf.push('\n');
            return;
        }
        NodeValue::Math(ref m) => {
            buf.push_str(&m.literal);
            return;
        }
        // Skip HTML and escaped tags; recurse into formatting nodes.
        NodeValue::HtmlInline(_) => return,
        NodeValue::Image(_) => return, // alt text not extracted here
        _ => {}
    }
    for child in node.children() {
        collect_text_inner(child, buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty_document() {
        let doc = parse("").unwrap();
        assert_eq!(doc.node_type, DocNodeType::Document);
        assert!(doc.children.unwrap_or_default().is_empty());
    }

    #[test]
    fn parse_heading_and_paragraph() {
        let src = "# Title\n\nSome text here.\n";
        let doc = parse(src).unwrap();
        let children = doc.children.unwrap();
        assert_eq!(children.len(), 2);
        assert_eq!(children[0].node_type, DocNodeType::Heading);
        assert_eq!(children[0].text.as_deref(), Some("Title"));
        assert_eq!(children[0].attrs.heading_level, Some(1));
        assert_eq!(children[1].node_type, DocNodeType::Paragraph);
        assert_eq!(children[1].text.as_deref(), Some("Some text here."));
    }

    #[test]
    fn parse_code_block_with_language() {
        let src = "```rust\nfn main() {}\n```\n";
        let doc = parse(src).unwrap();
        let children = doc.children.unwrap();
        assert_eq!(children[0].node_type, DocNodeType::Code);
        assert_eq!(children[0].attrs.code_language.as_deref(), Some("rust"));
        assert_eq!(children[0].text.as_deref(), Some("fn main() {}"));
    }

    #[test]
    fn parse_yaml_frontmatter_is_stripped() {
        let src = "---\ntitle: Hello\n---\n# Content\n";
        let doc = parse(src).unwrap();
        let children = doc.children.unwrap();
        // Only the heading should appear; frontmatter is skipped.
        assert!(children
            .iter()
            .all(|n| n.node_type != DocNodeType::Metadata));
        assert!(children.iter().any(|n| n.node_type == DocNodeType::Heading));
    }

    #[test]
    fn parse_gfm_table() {
        let src = "| A | B |\n|---|---|\n| 1 | 2 |\n";
        let doc = parse(src).unwrap();
        let children = doc.children.unwrap();
        assert_eq!(children[0].node_type, DocNodeType::Table);
        let rows = children[0].children.as_ref().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].attrs.is_header, Some(true));
    }

    #[test]
    fn byte_offsets_are_set() {
        let src = "# Hi\n\nParagraph.\n";
        let doc = parse(src).unwrap();
        for child in doc.children.unwrap() {
            assert!(child.attrs.byte_end > child.attrs.byte_start);
        }
    }
}
