/// Internal Rust trait for all embedding implementations in `virage-engine`.
pub trait Embedder: Send + Sync {
    fn dimensions(&self) -> usize;
    /// Embed a batch of texts. Returns a flat `Vec<f32>` of length `texts.len() * dimensions`.
    /// Caller slices into rows of `dimensions` elements each.
    fn embed_batch(&mut self, texts: &[String]) -> Result<Vec<f32>, String>;
}

#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
pub mod onnx;
