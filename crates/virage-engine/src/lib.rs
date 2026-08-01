#![deny(clippy::all)]

#[cfg(all(feature = "config", feature = "pipeline"))]
pub mod bench;
pub mod chunkers;
#[cfg(feature = "cli-binary")]
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
#[cfg(feature = "cli-binary")]
pub mod logging;
#[cfg(feature = "cli-binary")]
pub mod mcp;
#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
pub mod onnx;
#[cfg(feature = "cli-binary")]
pub mod output;
#[cfg(feature = "pipeline")]
pub mod pipeline;
#[cfg(feature = "wasm-host")]
pub mod plugins;
#[cfg(feature = "cli-binary")]
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
    feature = "store-types"
))]
pub mod stores;
