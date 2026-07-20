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

#[napi]
pub fn parse_latex(path: String) -> napi::Result<ParseResult> {
    let info =
        read_for_chunker(&path).map_err(|e| napi::Error::new(napi::Status::GenericFailure, e))?;
    let src = String::from_utf8(info.bytes).map_err(|e| {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("file {path} is not valid UTF-8: {e}"),
        )
    })?;
    let doc = parser::parse(&src).map_err(|e| {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("LaTeX parse error: {e}"),
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
