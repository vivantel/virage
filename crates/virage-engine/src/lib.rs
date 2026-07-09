#![deny(clippy::all)]

pub mod chunkers;
#[cfg(feature = "db-sqlite")]
pub mod db;
pub mod embedders;
#[cfg(any(feature = "source-git", feature = "source-localfs"))]
pub mod sources;
#[cfg(any(
    feature = "store-lancedb",
    feature = "store-qdrant",
    feature = "store-postgres",
    feature = "store-chromadb"
))]
pub mod stores;
