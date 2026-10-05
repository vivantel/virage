#![deny(clippy::all)]

#[cfg(all(feature = "config", feature = "pipeline"))]
pub mod bench;
pub mod chunkers;
#[cfg(any(
    feature = "cli-binary",
    feature = "cli-binary-dylib",
    feature = "cli-binary-full-dylib"
))]
pub mod cli;
#[cfg(feature = "config")]
pub mod config;
#[cfg(feature = "db-sqlite")]
pub mod db;
pub mod embedders;
#[cfg(all(feature = "config", feature = "eval-ragbench"))]
pub mod eval;
#[cfg(feature = "config")]
pub mod history;
#[cfg(any(
    feature = "cli-binary",
    feature = "cli-binary-dylib",
    feature = "cli-binary-full-dylib"
))]
pub mod logging;
#[cfg(any(
    feature = "cli-binary",
    feature = "cli-binary-dylib",
    feature = "cli-binary-full-dylib"
))]
pub mod mcp;
#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
pub mod onnx;
#[cfg(any(
    feature = "cli-binary",
    feature = "cli-binary-dylib",
    feature = "cli-binary-full-dylib"
))]
pub mod output;
#[cfg(feature = "pipeline")]
pub mod pipeline;
#[cfg(any(feature = "wasm-host", feature = "dylib-plugins"))]
pub mod plugins;
#[cfg(any(
    feature = "cli-binary",
    feature = "cli-binary-dylib",
    feature = "cli-binary-full-dylib"
))]
pub mod progress;
#[cfg(all(feature = "config", feature = "pipeline"))]
pub mod quality;
pub mod rerankers;
#[cfg(any(
    feature = "source-git",
    feature = "source-localfs",
    feature = "source-types"
))]
pub mod sources;
#[cfg(any(
    feature = "store-lancedb",
    feature = "store-qdrant",
    feature = "store-postgres",
    feature = "store-chromadb",
    feature = "store-dylib",
    feature = "store-types"
))]
pub mod stores;
