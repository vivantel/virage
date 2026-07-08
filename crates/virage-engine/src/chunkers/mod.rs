use virage_vidoc::DocNode;

/// Output of a successful `FileChunker::parse` call.
pub struct ParseResult {
    pub tree: DocNode,
    pub hash: String,
    pub size: f64,
    pub modified_ms: f64,
}

/// Internal Rust trait for all format-specific parsers in `virage-engine`.
///
/// Each impl reads the file at `path` via `virage_vidoc::read_for_chunker`,
/// parses the bytes into a ViDoc `DocNode` tree, and returns `ParseResult`.
pub trait FileChunker: Send + Sync {
    fn name(&self) -> &str;
    fn patterns(&self) -> &[&str];
    fn parse(&self, path: &str) -> Result<ParseResult, String>;
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
