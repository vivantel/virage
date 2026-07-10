pub trait Reranker: Send + Sync {
    /// Score each passage against the query. Returns one score per passage (higher = more relevant).
    fn rerank(&mut self, query: &str, passages: &[&str]) -> Result<Vec<f32>, String>;
}

#[cfg(feature = "embedder-onnx")]
pub mod cross_encoder;
