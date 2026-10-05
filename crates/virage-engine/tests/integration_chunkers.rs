//! Integration tests that run real format-specific chunkers against real
//! (in-memory-constructed) PDF/DOCX/MD/LaTeX files through the full
//! parse -> walk_to_chunks pipeline, rather than hand-built DocNode trees.
//!
//! PDF/DOCX bytes are built with the same crates the production chunkers
//! use to read them (lopdf, docx-rs) — real parseable format bytes, not
//! opaque checked-in binaries.

#[cfg(all(feature = "chunker-md", feature = "chunker-walk"))]
#[test]
fn md_real_fixture_produces_chunks_with_heading_breadcrumb() {
    use virage_engine::chunkers::md;
    use virage_engine::chunkers::walk::{walk_to_chunks, WalkOptions};

    let src = "\
# Title

Some paragraph text under the title.

## Sub

More text here under the sub-heading.
";
    let tree = md::parse(src).expect("md parse should succeed");

    let opts = WalkOptions {
        source_file: "fixture.md",
        source_format: "md",
        max_tokens: 200,
        ..Default::default()
    };
    let chunks = walk_to_chunks(&tree, &opts);

    assert!(!chunks.is_empty());
    assert!(
        chunks[0].dense_text.contains("Title"),
        "dense_text = {:?}",
        chunks[0].dense_text
    );
}

#[cfg(all(feature = "chunker-latex", feature = "chunker-walk"))]
#[test]
fn latex_real_fixture_section_becomes_heading_breadcrumb() {
    use virage_engine::chunkers::latex;
    use virage_engine::chunkers::walk::{walk_to_chunks, WalkOptions};

    let src = r"
\section{Introduction}
This is a paragraph with some real text content in it.
";
    let tree = latex::parse(src).expect("latex parse should succeed");

    let opts = WalkOptions {
        source_file: "fixture.tex",
        source_format: "latex",
        max_tokens: 200,
        ..Default::default()
    };
    let chunks = walk_to_chunks(&tree, &opts);

    assert!(!chunks.is_empty());
    assert!(
        chunks[0].dense_text.contains("Introduction"),
        "dense_text = {:?}",
        chunks[0].dense_text
    );
}

#[cfg(all(feature = "chunker-docx", feature = "chunker-walk"))]
#[test]
fn docx_real_fixture_heading_style_becomes_breadcrumb() {
    use std::io::Cursor;

    use docx_rs::{Docx, Paragraph, Run};
    use virage_engine::chunkers::docx;
    use virage_engine::chunkers::walk::{walk_to_chunks, WalkOptions};

    let heading = Paragraph::new()
        .style("Heading1")
        .add_run(Run::new().add_text("Overview"));
    let body = Paragraph::new().add_run(Run::new().add_text("Real docx paragraph text."));

    let mut buf = Vec::new();
    Docx::new()
        .add_paragraph(heading)
        .add_paragraph(body)
        .build()
        .pack(Cursor::new(&mut buf))
        .expect("packing a minimal docx should succeed");

    let tree = docx::parse(&buf).expect("docx parse should succeed");

    let opts = WalkOptions {
        source_file: "fixture.docx",
        source_format: "docx",
        max_tokens: 200,
        ..Default::default()
    };
    let chunks = walk_to_chunks(&tree, &opts);

    assert!(!chunks.is_empty());
    assert!(
        chunks[0].dense_text.contains("Overview"),
        "dense_text = {:?}",
        chunks[0].dense_text
    );
}

#[cfg(all(feature = "chunker-pdf", feature = "chunker-walk"))]
#[test]
fn pdf_real_fixture_page_number_survives_full_pipeline() {
    use lopdf::content::{Content, Operation};
    use lopdf::{dictionary, Document, Object, Stream};
    use virage_engine::chunkers::pdf;
    use virage_engine::chunkers::walk::{walk_to_chunks, WalkOptions};

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Courier",
    });
    let resources_id = doc.add_object(dictionary! {
        "Font" => dictionary! { "F1" => font_id },
    });

    let make_page = |doc: &mut Document, text: &str| {
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 24.into()]),
                Operation::new("Td", vec![50.into(), 700.into()]),
                Operation::new("Tj", vec![Object::string_literal(text)]),
                Operation::new("ET", vec![]),
            ],
        };
        let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
        doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => content_id,
        })
    };

    let page1_id = make_page(&mut doc, "First page content.");
    let page2_id = make_page(&mut doc, "Second page content.");

    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => vec![page1_id.into(), page2_id.into()],
        "Count" => 2,
        "Resources" => resources_id,
        "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);

    let mut bytes = Vec::new();
    doc.save_to(&mut bytes)
        .expect("saving a minimal 2-page pdf should succeed");

    let tree = pdf::parse(&bytes).expect("pdf parse should succeed");

    // Generous max_tokens: both pages' text fits in a single window, so this
    // exercises the same pageStart/pageEnd-spans-a-window path covered at the
    // unit level in chunkers::walk::tests, but through the real PDF parser.
    let opts = WalkOptions {
        source_file: "fixture.pdf",
        source_format: "pdf",
        max_tokens: 1000,
        ..Default::default()
    };
    let chunks = walk_to_chunks(&tree, &opts);

    assert!(!chunks.is_empty());
    let meta = &chunks[0].metadata;
    assert_eq!(meta["pageStart"].as_u64().unwrap(), 1);
    assert_eq!(meta["pageEnd"].as_u64().unwrap(), 2);
}
