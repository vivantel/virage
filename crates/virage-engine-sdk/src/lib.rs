//! Virage v2 SDK — WIT guest types and macros for WASM plugin authors.
//!
//! # Usage
//!
//! In your `Cargo.toml` (targeting `wasm32-wasip2`):
//! ```toml
//! [dependencies]
//! virage-engine-sdk = { git = "https://github.com/vivantel/virage" }
//! ```
//!
//! Implement a chunker plugin:
//! ```rust,ignore
//! virage_engine_sdk::chunker_impl! {
//!     struct MyChunker;
//!     // implement the generated Guest trait methods
//! }
//! ```
//!
//! See examples/ for working implementations.

/// Re-export wit-bindgen so plugin authors can use it without adding it directly.
pub use wit_bindgen;

/// Generate WIT guest bindings for the `chunker` world.
///
/// Call this macro once in your plugin crate's root, then implement the `Guest` trait.
#[macro_export]
macro_rules! chunker_world {
    () => {
        ::virage_engine_sdk::wit_bindgen::generate!({
            world: "chunker",
            path: concat!(env!("CARGO_MANIFEST_DIR"), "/../../wit"),
        });
    };
}
