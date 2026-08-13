/// Internal Rust trait for all embedding implementations in `virage-engine`.
pub trait Embedder: Send + Sync {
    fn dimensions(&self) -> usize;
    /// Embed a batch of texts. Returns a flat `Vec<f32>` of length `texts.len() * dimensions`.
    /// Caller slices into rows of `dimensions` elements each.
    ///
    /// Takes `&[&str]`, not `&[String]`: callers (`pipeline/worker.rs::embed_micro_batch`) hold
    /// their texts as fields on owned structs they need to keep around afterward (`ArtifactSet`),
    /// so building `&[String]` would force cloning every chunk's full text just to satisfy this
    /// signature. `&[&str]` lets a caller pass borrowed references instead — `OnnxEmbedder`
    /// already converted an incoming `&[String]` to `&[&str]` internally before this change (its
    /// tokenizer's `encode_single` wanted `&[&str]` too), so this also removes a redundant
    /// conversion on that side, not just the caller's clone.
    fn embed_batch(&mut self, texts: &[&str]) -> Result<Vec<f32>, String>;
}

#[cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]
pub mod onnx;
