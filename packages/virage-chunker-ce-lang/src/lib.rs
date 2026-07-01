#![deny(clippy::all)]

use napi_derive::napi;
use virage_vidoc::read_for_chunker;

mod parser;

#[napi(object)]
pub struct ParseResult {
    pub tree: String,
    pub hash: String,
    pub size: f64,
    pub modified_ms: f64,
}

/// Parse a source code file and return a ViDoc DocNode tree as JSON,
/// along with file hash and metadata. Language is detected from the
/// file extension; returns an error for unsupported extensions.
#[napi]
pub fn parse_code(path: String) -> napi::Result<ParseResult> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let lang = parser::Lang::from_extension(ext).ok_or_else(|| {
        napi::Error::new(
            napi::Status::InvalidArg,
            format!("unsupported file extension: .{ext}"),
        )
    })?;

    let info =
        read_for_chunker(&path).map_err(|e| napi::Error::new(napi::Status::GenericFailure, e))?;

    let doc = parser::parse(&info.bytes, &lang).map_err(|e| {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("parse error for {path}: {e}"),
        )
    })?;

    let tree = serde_json::to_string(&doc).map_err(|e| {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("serialization error: {e}"),
        )
    })?;

    Ok(ParseResult {
        tree,
        hash: info.hash,
        size: info.size,
        modified_ms: info.modified_ms,
    })
}
