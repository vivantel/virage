#![deny(clippy::all)]

pub mod chunkers;
#[cfg(feature = "config")]
pub mod config;
#[cfg(feature = "db-sqlite")]
pub mod db;
pub mod embedders;
#[cfg(feature = "pipeline")]
pub mod pipeline;
#[cfg(feature = "wasm-host")]
pub mod plugins;
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
