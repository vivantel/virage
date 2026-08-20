use virage_vidoc::DocNode;

/// Output of a successful `FileChunker::parse` call.
pub struct ParseResult {
    pub tree: DocNode,
}

/// Internal Rust trait for all format-specific parsers in `virage-engine`.
///
/// The caller (`pipeline::worker::parse_and_chunk`) reads `bytes` through the group's
/// `SourceProvider` — git, local fs, S3, etc. — before calling `parse`, so every impl here
/// parses in-memory bytes only and must never touch the local filesystem itself (that would
/// silently break indexing for any non-local source). `path` is passed only for
/// extension/error-message purposes (e.g. `LangChunker` picking a tree-sitter grammar).
pub trait FileChunker: Send + Sync {
    fn name(&self) -> &str;
    fn patterns(&self) -> &[&str];
    fn parse(&self, path: &str, bytes: &[u8]) -> Result<ParseResult, String>;
}

#[cfg(feature = "chunker-docx")]
pub mod docx;
#[cfg(feature = "chunker-lang")]
pub mod lang;
#[cfg(feature = "chunker-latex")]
pub mod latex;
#[cfg(feature = "chunker-md")]
pub mod md;
#[cfg(feature = "chunker-pdf")]
pub mod pdf;
#[cfg(feature = "chunker-walk")]
pub mod walk;
