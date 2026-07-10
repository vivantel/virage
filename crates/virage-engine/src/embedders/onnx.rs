use crate::onnx::{cls_pool, l2_normalize, mean_pool, OnnxInferenceSession, Pooling};

use super::Embedder;

pub struct OnnxEmbedder {
    session: OnnxInferenceSession,
    dimensions: usize,
    max_length: usize,
    pooling: Pooling,
    normalize: bool,
}

impl OnnxEmbedder {
    pub fn new(
        session: OnnxInferenceSession,
        dimensions: usize,
        max_length: usize,
        pooling: Pooling,
        normalize: bool,
    ) -> Self {
        Self { session, dimensions, max_length, pooling, normalize }
    }
}

impl Embedder for OnnxEmbedder {
    fn dimensions(&self) -> usize {
        self.dimensions
    }

    fn embed_batch(&mut self, texts: &[String]) -> Result<Vec<f32>, String> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let text_refs: Vec<&str> = texts.iter().map(String::as_str).collect();
        let batch = self.session.encode_single(&text_refs, self.max_length)?;
        let (ids_t, mask_t, types_t) = batch.to_tensors()?;

        let outputs = self
            .session
            .session
            .run(ort::inputs![
                "input_ids"      => ids_t,
                "attention_mask" => mask_t,
                "token_type_ids" => types_t,
            ])
            .map_err(|e| format!("ORT inference error: {e}"))?;

        let hidden_key = if outputs.contains_key("last_hidden_state") {
            "last_hidden_state"
        } else {
            outputs
                .keys()
                .next()
                .ok_or_else(|| "ONNX model produced no outputs".to_string())?
        };

        let (_shape, hidden) = outputs[hidden_key]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("tensor extract error: {e}"))?;

        let pooled = match self.pooling {
            Pooling::Mean => mean_pool(
                hidden,
                &batch.attention_mask,
                batch.batch_size,
                batch.seq_len,
                self.dimensions,
            ),
            Pooling::Cls => cls_pool(hidden, batch.batch_size, self.dimensions),
        };

        if self.normalize {
            Ok(pooled.chunks(self.dimensions).flat_map(l2_normalize).collect())
        } else {
            Ok(pooled)
        }
    }
}

// ─── Unit tests (pure math — no ORT session required) ────────────────────────

#[cfg(test)]
mod tests {
    use crate::onnx::{cls_pool, l2_normalize, mean_pool};

    fn approx_eq(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-5
    }

    fn vec_approx_eq(a: &[f32], b: &[f32]) -> bool {
        a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| approx_eq(*x, *y))
    }

    #[test]
    fn l2_normalize_unit_vector() {
        let v = vec![3.0f32, 4.0];
        let n = l2_normalize(&v);
        assert!(approx_eq(n[0], 0.6));
        assert!(approx_eq(n[1], 0.8));
        let norm: f32 = n.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!(approx_eq(norm, 1.0));
    }

    #[test]
    fn l2_normalize_zero_vector_returns_unchanged() {
        let v = vec![0.0f32, 0.0, 0.0];
        let n = l2_normalize(&v);
        assert!(vec_approx_eq(&n, &[0.0, 0.0, 0.0]));
    }

    #[test]
    fn l2_normalize_already_unit() {
        let v = vec![1.0f32, 0.0, 0.0];
        let n = l2_normalize(&v);
        assert!(vec_approx_eq(&n, &[1.0, 0.0, 0.0]));
    }

    #[test]
    fn mean_pool_all_tokens_attended() {
        let hidden = vec![1.0f32, 2.0, 3.0, 4.0];
        let mask = vec![1i64, 1];
        let result = mean_pool(&hidden, &mask, 1, 2, 2);
        assert!(vec_approx_eq(&result, &[2.0, 3.0]));
    }

    #[test]
    fn mean_pool_ignores_padding_tokens() {
        let hidden = vec![1.0f32, 0.0, 3.0, 0.0, 99.0, 99.0];
        let mask = vec![1i64, 1, 0];
        let result = mean_pool(&hidden, &mask, 1, 3, 2);
        assert!(vec_approx_eq(&result, &[2.0, 0.0]));
    }

    #[test]
    fn mean_pool_batch_of_two() {
        let hidden = vec![1.0f32, 2.0, 3.0, 4.0, 6.0, 0.0, 0.0, 0.0];
        let mask = vec![1i64, 1, 1, 0];
        let result = mean_pool(&hidden, &mask, 2, 2, 2);
        assert_eq!(result.len(), 4);
        assert!(vec_approx_eq(&result[0..2], &[2.0, 3.0]));
        assert!(vec_approx_eq(&result[2..4], &[6.0, 0.0]));
    }

    #[test]
    fn mean_pool_all_padding_clips_to_small_denom() {
        let hidden = vec![0.0f32, 0.0, 0.0, 0.0];
        let mask = vec![0i64, 0];
        let result = mean_pool(&hidden, &mask, 1, 2, 2);
        assert!(result.iter().all(|x| x.abs() < 1e-5));
    }

    #[test]
    fn cls_pool_takes_first_token() {
        let hidden = vec![5.0f32, 6.0, 1.0, 2.0, 3.0, 4.0];
        let result = cls_pool(&hidden, 1, 2);
        assert!(vec_approx_eq(&result, &[5.0, 6.0]));
    }

    #[test]
    fn cls_pool_batch_of_two() {
        let hidden = vec![1.0f32, 2.0, 3.0, 4.0, 7.0, 8.0, 9.0, 10.0];
        let result = cls_pool(&hidden, 2, 2);
        assert_eq!(result.len(), 4);
        assert!(vec_approx_eq(&result[0..2], &[1.0, 2.0]));
        assert!(vec_approx_eq(&result[2..4], &[7.0, 8.0]));
    }
}
