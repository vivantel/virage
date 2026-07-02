use napi::bindgen_prelude::*;
use napi_derive::napi;
use ort::{session::Session, value::Tensor};
use tokenizers::Tokenizer;

#[napi]
pub struct OnnxEmbedder {
    session: Session,
    tokenizer: Tokenizer,
    dimensions: usize,
    max_length: usize,
    pooling: Pooling,
    normalize: bool,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Pooling {
    Mean,
    Cls,
}

#[napi]
impl OnnxEmbedder {
    #[napi(constructor)]
    pub fn new(
        model_path: String,
        tokenizer_path: String,
        dimensions: u32,
        max_length: Option<u32>,
        pooling: Option<String>,
        normalize: Option<bool>,
    ) -> napi::Result<Self> {
        let session = Session::builder()
            .map_err(|e| napi::Error::from_reason(e.to_string()))?
            .commit_from_file(&model_path)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        let pooling = parse_pooling(pooling.as_deref());

        Ok(Self {
            session,
            tokenizer,
            dimensions: dimensions as usize,
            max_length: max_length.unwrap_or(512) as usize,
            pooling,
            normalize: normalize.unwrap_or(true),
        })
    }

    /// Embed a single text. Returns a `Float32Array` of length `dimensions`.
    #[napi]
    pub fn embed(&mut self, text: String) -> napi::Result<Float32Array> {
        let vecs = self.run_batch(&[text])?;
        Ok(Float32Array::new(vecs))
    }

    /// Embed a batch of texts. Returns a flat `Float32Array` of length
    /// `texts.len() * dimensions`. Caller slices into rows.
    #[napi]
    pub fn embed_batch(&mut self, texts: Vec<String>) -> napi::Result<Float32Array> {
        let flat = self.run_batch(&texts)?;
        Ok(Float32Array::new(flat))
    }

    #[napi(getter)]
    pub fn dimensions(&self) -> u32 {
        self.dimensions as u32
    }
}

impl OnnxEmbedder {
    fn run_batch(&mut self, texts: &[String]) -> napi::Result<Vec<f32>> {
        let batch_size = texts.len();
        if batch_size == 0 {
            return Ok(vec![]);
        }

        // --- Tokenize ---------------------------------------------------------
        let encoded = self
            .tokenizer
            .encode_batch(texts.iter().map(|s| s.as_str()).collect::<Vec<_>>(), true)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        let seq_len = encoded
            .iter()
            .map(|e| e.get_ids().len().min(self.max_length))
            .max()
            .unwrap_or(0);

        let n = batch_size * seq_len;
        let mut input_ids = vec![0i64; n];
        let mut attention_mask = vec![0i64; n];
        let mut token_type_ids = vec![0i64; n];

        for (b, enc) in encoded.iter().enumerate() {
            let ids = enc.get_ids();
            let mask = enc.get_attention_mask();
            let types = enc.get_type_ids();
            let len = ids.len().min(self.max_length).min(seq_len);
            let base = b * seq_len;
            for i in 0..len {
                input_ids[base + i] = ids[i] as i64;
                attention_mask[base + i] = mask[i] as i64;
                token_type_ids[base + i] = types[i] as i64;
            }
        }

        // --- Build ORT tensors ------------------------------------------------
        let shape = [batch_size, seq_len];
        let ids_t = Tensor::from_array((shape, input_ids.clone().into_boxed_slice()))
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let mask_t = Tensor::from_array((shape, attention_mask.clone().into_boxed_slice()))
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let types_t = Tensor::from_array((shape, token_type_ids.into_boxed_slice()))
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        // --- Run inference ----------------------------------------------------
        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids"      => ids_t,
                "attention_mask" => mask_t,
                "token_type_ids" => types_t,
            ])
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        let hidden_key = if outputs.contains_key("last_hidden_state") {
            "last_hidden_state"
        } else {
            outputs
                .keys()
                .next()
                .ok_or_else(|| napi::Error::from_reason("ONNX model produced no outputs"))?
        };

        // ort 2.0-rc: try_extract_tensor returns (Shape, &[T])
        let (_shape, hidden_data) = outputs[hidden_key]
            .try_extract_tensor::<f32>()
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        // --- Pool + optionally normalize --------------------------------------
        let pooled = match self.pooling {
            Pooling::Mean => mean_pool(
                hidden_data,
                &attention_mask,
                batch_size,
                seq_len,
                self.dimensions,
            ),
            Pooling::Cls => cls_pool(hidden_data, batch_size, self.dimensions),
        };

        if self.normalize {
            Ok(pooled
                .chunks(self.dimensions)
                .flat_map(l2_normalize)
                .collect())
        } else {
            Ok(pooled)
        }
    }
}

// ---------------------------------------------------------------------------
// Pure functions — exposed for unit tests
// ---------------------------------------------------------------------------

fn parse_pooling(s: Option<&str>) -> Pooling {
    match s {
        Some("cls") => Pooling::Cls,
        _ => Pooling::Mean,
    }
}

/// Mean pool over non-padding tokens.
/// `hidden` is flat row-major [B, S, D]; `mask` is [B, S] as i64.
pub(crate) fn mean_pool(
    hidden: &[f32],
    mask: &[i64],
    batch_size: usize,
    seq_len: usize,
    dim: usize,
) -> Vec<f32> {
    let mut out = Vec::with_capacity(batch_size * dim);
    for b in 0..batch_size {
        let mut sum = vec![0.0f32; dim];
        let mut count = 0.0f32;
        for s in 0..seq_len {
            if mask[b * seq_len + s] == 0 {
                continue;
            }
            let base = b * seq_len * dim + s * dim;
            for k in 0..dim {
                sum[k] += hidden[base + k];
            }
            count += 1.0;
        }
        let denom = count.max(1e-9);
        out.extend(sum.iter().map(|x| x / denom));
    }
    out
}

/// CLS pool — take the first token of each item.
/// `hidden` is flat row-major [B, S, D].
pub(crate) fn cls_pool(hidden: &[f32], batch_size: usize, dim: usize) -> Vec<f32> {
    let stride_b = hidden.len() / batch_size;
    (0..batch_size)
        .flat_map(|b| hidden[b * stride_b..b * stride_b + dim].iter().copied())
        .collect()
}

pub(crate) fn l2_normalize(v: &[f32]) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm < 1e-12 {
        return v.to_vec();
    }
    v.iter().map(|x| x / norm).collect()
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-5
    }

    fn vec_approx_eq(a: &[f32], b: &[f32]) -> bool {
        a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| approx_eq(*x, *y))
    }

    // --- l2_normalize -------------------------------------------------------

    #[test]
    fn l2_normalize_unit_vector() {
        let v = vec![3.0f32, 4.0];
        let n = l2_normalize(&v);
        assert!(approx_eq(n[0], 0.6));
        assert!(approx_eq(n[1], 0.8));
        // resulting vector should have norm ≈ 1
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

    // --- mean_pool ----------------------------------------------------------

    #[test]
    fn mean_pool_all_tokens_attended() {
        // batch=1, seq=2, dim=2
        // token 0: [1.0, 2.0]  token 1: [3.0, 4.0]
        // mean = [2.0, 3.0]
        let hidden = vec![1.0f32, 2.0, 3.0, 4.0];
        let mask = vec![1i64, 1];
        let result = mean_pool(&hidden, &mask, 1, 2, 2);
        assert!(vec_approx_eq(&result, &[2.0, 3.0]));
    }

    #[test]
    fn mean_pool_ignores_padding_tokens() {
        // batch=1, seq=3, dim=2
        // token 0: [1.0, 0.0]  token 1: [3.0, 0.0]  token 2 (pad): [99.0, 99.0]
        // mask=[1,1,0] → mean over first two only = [2.0, 0.0]
        let hidden = vec![1.0f32, 0.0, 3.0, 0.0, 99.0, 99.0];
        let mask = vec![1i64, 1, 0];
        let result = mean_pool(&hidden, &mask, 1, 3, 2);
        assert!(vec_approx_eq(&result, &[2.0, 0.0]));
    }

    #[test]
    fn mean_pool_batch_of_two() {
        // batch=2, seq=2, dim=2
        // item 0: tokens [1,2] [3,4] mask=[1,1] → mean=[2,3]
        // item 1: tokens [6,0] [0,0] mask=[1,0] → mean=[6,0]
        let hidden = vec![1.0f32, 2.0, 3.0, 4.0, 6.0, 0.0, 0.0, 0.0];
        let mask = vec![1i64, 1, 1, 0];
        let result = mean_pool(&hidden, &mask, 2, 2, 2);
        assert_eq!(result.len(), 4);
        assert!(vec_approx_eq(&result[0..2], &[2.0, 3.0]));
        assert!(vec_approx_eq(&result[2..4], &[6.0, 0.0]));
    }

    #[test]
    fn mean_pool_all_padding_clips_to_small_denom() {
        // All tokens masked — result is sum/1e-9 ≈ 0
        let hidden = vec![0.0f32, 0.0, 0.0, 0.0];
        let mask = vec![0i64, 0];
        let result = mean_pool(&hidden, &mask, 1, 2, 2);
        assert!(result.iter().all(|x| x.abs() < 1e-5));
    }

    // --- cls_pool -----------------------------------------------------------

    #[test]
    fn cls_pool_takes_first_token() {
        // batch=1, seq=3, dim=2 → first token is [5.0, 6.0]
        let hidden = vec![5.0f32, 6.0, 1.0, 2.0, 3.0, 4.0];
        let result = cls_pool(&hidden, 1, 2);
        assert!(vec_approx_eq(&result, &[5.0, 6.0]));
    }

    #[test]
    fn cls_pool_batch_of_two() {
        // batch=2, seq=2, dim=2
        // item 0 CLS=[1,2], item 1 CLS=[7,8]
        let hidden = vec![1.0f32, 2.0, 3.0, 4.0, 7.0, 8.0, 9.0, 10.0];
        let result = cls_pool(&hidden, 2, 2);
        assert_eq!(result.len(), 4);
        assert!(vec_approx_eq(&result[0..2], &[1.0, 2.0]));
        assert!(vec_approx_eq(&result[2..4], &[7.0, 8.0]));
    }

    // --- parse_pooling ------------------------------------------------------

    #[test]
    fn parse_pooling_defaults_to_mean() {
        assert_eq!(parse_pooling(None), Pooling::Mean);
        assert_eq!(parse_pooling(Some("other")), Pooling::Mean);
    }

    #[test]
    fn parse_pooling_cls() {
        assert_eq!(parse_pooling(Some("cls")), Pooling::Cls);
    }
}
