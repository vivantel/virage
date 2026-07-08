#![deny(clippy::all)]

pub mod chunkers;
pub mod embedders;
#[cfg(any(feature = "source-git", feature = "source-localfs"))]
pub mod sources;
