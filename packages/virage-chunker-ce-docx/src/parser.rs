use docx_rs::{
    read_docx, DocumentChild, InsertChild, ParagraphChild, RunChild, TableCellContent, TableChild,
    TableRowChild,
};
use virage_vidoc::{DocNode, DocNodeAttrs, DocNodeType};

/// Parse raw DOCX bytes into a ViDoc DocNode tree.
///
/// Strategy:
/// - Walk `document.children` (Paragraph | Table | ...).
/// - Map Word styles: Heading1–Heading6 → heading nodes with the appropriate level.
/// - All other paragraph styles → paragraph nodes.
/// - Tracked changes: `Insert` children are included; `Delete` children are skipped.
/// - Tables: rows → `table-row` nodes; cells → `table-cell` nodes.
/// - Byte offsets: approximated from accumulated character counts (DOCX is a ZIP;
///   raw byte positions are not available after decompression).
pub fn parse(bytes: &[u8]) -> Result<DocNode, Box<dyn std::error::Error>> {
    let docx = read_docx(bytes)?;
    let mut children: Vec<DocNode> = Vec::new();
    let mut byte_cursor: u64 = 0;

    for child in &docx.document.children {
        match child {
            DocumentChild::Paragraph(p) => {
                let heading_level =
                    heading_level_from_style(p.property.style.as_ref().map(|s| s.val.as_str()));
                let text = collect_paragraph_text(p);

                if text.is_empty() {
                    continue;
                }

                let bs = byte_cursor;
                byte_cursor += text.len() as u64 + 1;
                let be = byte_cursor;

                if let Some(level) = heading_level {
                    children.push(DocNode {
                        node_type: DocNodeType::Heading,
                        children: None,
                        text: Some(text),
                        attrs: DocNodeAttrs {
                            heading_level: Some(level),
                            byte_start: bs,
                            byte_end: be,
                            source_format: Some("docx".to_string()),
                            ..Default::default()
                        },
                    });
                } else {
                    children.push(DocNode {
                        node_type: DocNodeType::Paragraph,
                        children: None,
                        text: Some(text),
                        attrs: DocNodeAttrs {
                            byte_start: bs,
                            byte_end: be,
                            source_format: Some("docx".to_string()),
                            ..Default::default()
                        },
                    });
                }
            }

            DocumentChild::Table(t) => {
                let table_bs = byte_cursor;
                let mut row_nodes: Vec<DocNode> = Vec::new();

                for (row_idx, row_child) in t.rows.iter().enumerate() {
                    let TableChild::TableRow(row) = row_child;
                    let row_bs = byte_cursor;
                    let mut cell_nodes: Vec<DocNode> = Vec::new();

                    for (col_idx, cell_child) in row.cells.iter().enumerate() {
                        let TableRowChild::TableCell(cell) = cell_child;
                        let cell_bs = byte_cursor;

                        // Collect text from all paragraphs within the cell.
                        let cell_text: String = cell
                            .children
                            .iter()
                            .filter_map(|cc| match cc {
                                TableCellContent::Paragraph(cp) => {
                                    let t = collect_paragraph_text(cp);
                                    if t.is_empty() {
                                        None
                                    } else {
                                        Some(t)
                                    }
                                }
                                _ => None,
                            })
                            .collect::<Vec<_>>()
                            .join(" ");

                        byte_cursor += cell_text.len() as u64 + 1;
                        let cell_be = byte_cursor;

                        cell_nodes.push(DocNode {
                            node_type: DocNodeType::TableCell,
                            children: None,
                            text: if cell_text.is_empty() {
                                None
                            } else {
                                Some(cell_text)
                            },
                            attrs: DocNodeAttrs {
                                table_row: Some(row_idx as u32),
                                table_col: Some(col_idx as u32),
                                is_header: if row_idx == 0 { Some(true) } else { None },
                                byte_start: cell_bs,
                                byte_end: cell_be,
                                ..Default::default()
                            },
                        });
                    }

                    let row_be = byte_cursor;
                    row_nodes.push(DocNode {
                        node_type: DocNodeType::TableRow,
                        children: Some(cell_nodes),
                        text: None,
                        attrs: DocNodeAttrs {
                            table_row: Some(row_idx as u32),
                            is_header: if row_idx == 0 { Some(true) } else { None },
                            byte_start: row_bs,
                            byte_end: row_be,
                            ..Default::default()
                        },
                    });
                }

                let table_be = byte_cursor;
                if !row_nodes.is_empty() {
                    children.push(DocNode {
                        node_type: DocNodeType::Table,
                        children: Some(row_nodes),
                        text: None,
                        attrs: DocNodeAttrs {
                            byte_start: table_bs,
                            byte_end: table_be,
                            source_format: Some("docx".to_string()),
                            ..Default::default()
                        },
                    });
                }
            }

            // Skip all other document-level children (bookmarks, SDTs, TOC, etc.)
            _ => {}
        }
    }

    Ok(DocNode {
        node_type: DocNodeType::Document,
        children: Some(children),
        text: None,
        attrs: DocNodeAttrs {
            byte_start: 0,
            byte_end: byte_cursor,
            source_format: Some("docx".to_string()),
            ..Default::default()
        },
    })
}

/// Map Word paragraph style names to heading levels.
/// Word uses "Heading1"–"Heading6" (no space) or "Heading 1"–"Heading 6".
fn heading_level_from_style(style: Option<&str>) -> Option<u8> {
    let s = style?;
    // Normalize: remove spaces and make lowercase for comparison
    let s = s.replace(' ', "").to_lowercase();
    match s.as_str() {
        "heading1" => Some(1),
        "heading2" => Some(2),
        "heading3" => Some(3),
        "heading4" => Some(4),
        "heading5" => Some(5),
        "heading6" => Some(6),
        _ => None,
    }
}

/// Collect all text from a paragraph's run children.
/// Includes `Insert` (tracked additions); skips `Delete` (tracked deletions).
fn collect_paragraph_text(para: &docx_rs::Paragraph) -> String {
    let mut buf = String::new();
    for child in &para.children {
        match child {
            ParagraphChild::Run(run) => collect_run_text(run, &mut buf),
            ParagraphChild::Insert(ins) => {
                for ic in &ins.children {
                    if let InsertChild::Run(run) = ic {
                        collect_run_text(run, &mut buf);
                    }
                }
            }
            // Skip Delete and all other children
            _ => {}
        }
    }
    buf.trim().to_owned()
}

fn collect_run_text(run: &docx_rs::Run, buf: &mut String) {
    for rc in &run.children {
        match rc {
            RunChild::Text(t) => buf.push_str(&t.text),
            RunChild::Tab(_) => buf.push('\t'),
            RunChild::Break(_) => buf.push('\n'),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heading_level_mapping() {
        assert_eq!(heading_level_from_style(Some("Heading1")), Some(1));
        assert_eq!(heading_level_from_style(Some("Heading 2")), Some(2));
        assert_eq!(heading_level_from_style(Some("heading6")), Some(6));
        assert_eq!(heading_level_from_style(Some("Normal")), None);
        assert_eq!(heading_level_from_style(None), None);
    }

    #[test]
    fn parse_invalid_bytes_returns_error() {
        assert!(parse(b"not a docx file").is_err());
    }
}
