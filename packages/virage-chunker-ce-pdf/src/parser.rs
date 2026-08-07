use lopdf::Document;
use virage_vidoc::{DocNode, DocNodeAttrs, DocNodeType};

/// Parse raw PDF bytes into a ViDoc DocNode tree.
///
/// Strategy:
/// 1. Load with lopdf — handles compressed streams, cross-references, encryption errors gracefully.
/// 2. Iterate pages in order; extract raw text per page.
/// 3. Split page text into paragraphs at blank lines.
/// 4. Apply a lightweight heading heuristic: short lines (≤ 80 chars) that don't end
///    with sentence-terminating punctuation are emitted as heading nodes.
/// 5. Byte offsets are approximated from accumulated character counts because PDF streams
///    don't expose source positions after decoding.
pub fn parse(bytes: &[u8]) -> Result<DocNode, Box<dyn std::error::Error>> {
    let doc = Document::load_mem(bytes)?;
    let pages = doc.get_pages(); // BTreeMap<page_number_1based, ObjectId>

    let mut children: Vec<DocNode> = Vec::new();
    let mut byte_cursor: u64 = 0;

    for (&page_num, &page_id) in &pages {
        let page_text = match doc.extract_text(&[page_id.0]) {
            Ok(t) => t,
            Err(_) => continue, // skip pages with unextractable text (images, encrypted)
        };

        if page_text.trim().is_empty() {
            continue;
        }

        let page_bs = byte_cursor;
        let page_nodes = parse_page_text(&page_text, page_num, &mut byte_cursor);
        let page_be = byte_cursor;

        if !page_nodes.is_empty() {
            children.push(DocNode {
                node_type: DocNodeType::Section,
                children: Some(page_nodes),
                text: None,
                attrs: DocNodeAttrs {
                    byte_start: page_bs,
                    byte_end: page_be,
                    page_number: Some(page_num),
                    source_format: Some("pdf".to_string()),
                    ..Default::default()
                },
            });
        }
    }

    Ok(DocNode {
        node_type: DocNodeType::Document,
        children: Some(children),
        text: None,
        attrs: DocNodeAttrs {
            byte_start: 0,
            byte_end: byte_cursor,
            source_format: Some("pdf".to_string()),
            ..Default::default()
        },
    })
}

/// Split a page's extracted text into ViDoc nodes (headings + paragraphs).
fn parse_page_text(text: &str, page_num: u32, cursor: &mut u64) -> Vec<DocNode> {
    let mut nodes = Vec::new();

    // Split on blank lines to get candidate paragraphs/headings.
    for block in text.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }

        let bs = *cursor;
        *cursor += block.len() as u64 + 2; // +2 for the \n\n separator
        let be = *cursor;

        if is_heading_heuristic(block) {
            nodes.push(DocNode {
                node_type: DocNodeType::Heading,
                children: None,
                text: Some(block.to_owned()),
                attrs: DocNodeAttrs {
                    heading_level: Some(detect_heading_level(block)),
                    byte_start: bs,
                    byte_end: be,
                    page_number: Some(page_num),
                    ..Default::default()
                },
            });
        } else {
            // Collapse internal newlines to spaces for readable paragraph text.
            let para_text = block.replace('\n', " ");
            nodes.push(DocNode {
                node_type: DocNodeType::Paragraph,
                children: None,
                text: Some(para_text),
                attrs: DocNodeAttrs {
                    byte_start: bs,
                    byte_end: be,
                    page_number: Some(page_num),
                    ..Default::default()
                },
            });
        }
    }

    nodes
}

/// Heuristic: a text block is a heading if it is short and lacks sentence-ending punctuation.
fn is_heading_heuristic(block: &str) -> bool {
    // Must be a single line (no embedded newlines after trimming means single paragraph block)
    if block.contains('\n') {
        return false;
    }
    // Short enough to be a title
    if block.len() > 120 {
        return false;
    }
    // Does not end with sentence-terminating characters
    let last = block.chars().next_back().unwrap_or(' ');
    !matches!(last, '.' | ',' | ';' | ':' | '!' | '?' | ')')
}

/// Approximate heading level from contextual signals.
/// Level 1 = ALL CAPS or very short (≤ 30 chars); Level 2 = everything else.
fn detect_heading_level(text: &str) -> u8 {
    let all_caps = text
        .chars()
        .filter(|c| c.is_alphabetic())
        .all(|c| c.is_uppercase());
    if all_caps || text.len() <= 30 {
        1
    } else {
        2
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heading_heuristic_short_no_punct() {
        assert!(is_heading_heuristic("Introduction"));
        assert!(is_heading_heuristic("Chapter 1: Overview"));
        assert!(!is_heading_heuristic(
            "This is a full sentence with a period."
        ));
        assert!(!is_heading_heuristic("Multi\nline block"));
    }

    #[test]
    fn heading_level_detection() {
        assert_eq!(detect_heading_level("ABSTRACT"), 1);
        assert_eq!(detect_heading_level("Introduction"), 1); // ≤ 30 chars
        assert_eq!(
            detect_heading_level("A Longer Section Title That Exceeds Thirty Chars"),
            2
        );
    }

    #[test]
    fn parse_page_text_produces_nodes() {
        let text = "Introduction\n\nThis is the first paragraph of the document.";
        let mut cursor = 0u64;
        let nodes = parse_page_text(text, 1, &mut cursor);
        assert!(!nodes.is_empty());
        let heading = &nodes[0];
        assert_eq!(heading.node_type, DocNodeType::Heading);
        assert_eq!(heading.text.as_deref(), Some("Introduction"));
        let para = &nodes[1];
        assert_eq!(para.node_type, DocNodeType::Paragraph);
    }

    #[test]
    fn parse_empty_bytes_returns_error() {
        // Empty slice is not a valid PDF
        assert!(parse(b"").is_err());
    }
}
