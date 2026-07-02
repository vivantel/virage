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

#[derive(Clone, Copy)]
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

        let pooling = match pooling.as_deref().unwrap_or("mean") {
            "cls" => Pooling::Cls,
            _ => Pooling::Mean,
        };

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

        // ort 2.0-rc: try_extract_raw_tensor returns (Shape, &[T])
        let (_shape, hidden_data) = outputs[hidden_key]
            .try_extract_tensor::<f32>()
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        // hidden_data is flat row-major [B, S, D]:
        //   hidden_data[b * seq_len * D + s * D + d]
        let d = self.dimensions;
        let stride_b = seq_len * d;

        // --- Pool + optionally normalize --------------------------------------
        let mut out = Vec::with_capacity(batch_size * d);
        for b in 0..batch_size {
            let base_b = b * stride_b;
            let vec: Vec<f32> = match self.pooling {
                Pooling::Cls => hidden_data[base_b..base_b + d].to_vec(),
                Pooling::Mean => {
                    let mut sum = vec![0.0f32; d];
                    let mut count = 0.0f32;
                    for s in 0..seq_len {
                        if attention_mask[b * seq_len + s] == 0 {
                            continue;
                        }
                        let base_s = base_b + s * d;
                        for k in 0..d {
                            sum[k] += hidden_data[base_s + k];
                        }
                        count += 1.0;
                    }
                    let denom = count.max(1e-9);
                    sum.iter().map(|x| x / denom).collect()
                }
            };

            if self.normalize {
                out.extend(l2_normalize(&vec));
            } else {
                out.extend(vec);
            }
        }

        Ok(out)
    }
}

#[inline]
fn l2_normalize(v: &[f32]) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm < 1e-12 {
        return v.to_vec();
    }
    v.iter().map(|x| x / norm).collect()
}
