#![deny(clippy::all)]

pub mod chunkers;
#[cfg(feature = "config")]
pub mod config;
#[cfg(feature = "db-sqlite")]
pub mod db;
pub mod embedders;
#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
pub mod onnx;
#[cfg(feature = "pipeline")]
pub mod pipeline;
#[cfg(feature = "wasm-host")]
pub mod plugins;
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
