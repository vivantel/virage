//! Shared ONNX inference session — used by OnnxEmbedder and CrossEncoderReranker.

use ort::{session::Session, value::Tensor};
use tokenizers::Tokenizer;

// ─── Strategy enums ───────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Pooling {
    #[default]
    Mean,
    Cls,
}

#[derive(Clone, Copy, Debug, Default)]
pub enum ScoreActivation {
    #[default]
    None,
    Sigmoid,
    Softmax,
}

// ─── Encoded batch ────────────────────────────────────────────────────────────

pub struct EncodedBatch {
    pub input_ids: Vec<i64>,
    pub attention_mask: Vec<i64>,
    pub token_type_ids: Vec<i64>,
    pub batch_size: usize,
    pub seq_len: usize,
}

type InputTensors = (Tensor<i64>, Tensor<i64>, Tensor<i64>);

impl EncodedBatch {
    pub fn to_tensors(&self) -> Result<InputTensors, String> {
        let shape = [self.batch_size, self.seq_len];
        let ids_t = Tensor::from_array((shape, self.input_ids.clone().into_boxed_slice()))
            .map_err(|e| format!("tensor build error: {e}"))?;
        let mask_t = Tensor::from_array((shape, self.attention_mask.clone().into_boxed_slice()))
            .map_err(|e| format!("tensor build error: {e}"))?;
        let types_t = Tensor::from_array((shape, self.token_type_ids.clone().into_boxed_slice()))
            .map_err(|e| format!("tensor build error: {e}"))?;
        Ok((ids_t, mask_t, types_t))
    }
}

// ─── Shared inference session ─────────────────────────────────────────────────

pub struct OnnxInferenceSession {
    pub session: Session,
    pub tokenizer: Tokenizer,
}

impl OnnxInferenceSession {
    pub fn from_paths(model_path: &str, tokenizer_path: &str) -> Result<Self, String> {
        // api-22 causes SessionBuilder::new() to call SetEpSelectionPolicy(MaxEfficiency=PreferNPU),
        // which probes all compiled-in EPs including OpenVINO. On machines without Intel VPU drivers
        // this SIGSEGV-crashes via _exit(1) before any Rust error handling runs.
        // Fix: explicitly register CPU EP at session level. Per ort crate docs, with_execution_providers
        // overrides the MaxEfficiency policy when api-22 was the one that set it.
        // See docs/ai/facts/ort-ep-selection.md for full probe chain and attempt history.
        let session = Session::builder()
            .map_err(|e| format!("ORT session builder error: {e}"))?
            .with_execution_providers([
                ort::execution_providers::CPUExecutionProvider::default().build()
            ])
            .map_err(|e| format!("ORT CPU EP registration error: {e}"))?
            .commit_from_file(model_path)
            .map_err(|e| format!("ORT model load error: {e}"))?;
        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| format!("tokenizer load error: {e}"))?;
        Ok(Self { session, tokenizer })
    }

    /// Encode a batch of single texts.
    pub fn encode_single(&self, texts: &[&str], max_length: usize) -> Result<EncodedBatch, String> {
        let encoded = self
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|e| format!("tokenizer encode error: {e}"))?;
        Ok(pack_encodings(&encoded, max_length))
    }

    /// Encode (query, passage) pairs — produces `[CLS] query [SEP] passage [SEP]` per pair.
    pub fn encode_pair(
        &self,
        pairs: &[(&str, &str)],
        max_length: usize,
    ) -> Result<EncodedBatch, String> {
        let inputs: Vec<(String, String)> = pairs
            .iter()
            .map(|(q, p)| (q.to_string(), p.to_string()))
            .collect();
        let encoded = self
            .tokenizer
            .encode_batch(inputs, true)
            .map_err(|e| format!("tokenizer pair encode error: {e}"))?;
        Ok(pack_encodings(&encoded, max_length))
    }
}

fn pack_encodings(encoded: &[tokenizers::Encoding], max_length: usize) -> EncodedBatch {
    let batch_size = encoded.len();
    let seq_len = encoded
        .iter()
        .map(|e| e.get_ids().len().min(max_length))
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
        let len = ids.len().min(max_length).min(seq_len);
        let base = b * seq_len;
        for i in 0..len {
            input_ids[base + i] = ids[i] as i64;
            attention_mask[base + i] = mask[i] as i64;
            token_type_ids[base + i] = types[i] as i64;
        }
    }

    EncodedBatch {
        input_ids,
        attention_mask,
        token_type_ids,
        batch_size,
        seq_len,
    }
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

/// Mean pool over non-padding tokens. `hidden` is flat [B, S, D]; `mask` is [B, S].
pub fn mean_pool(
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

/// CLS pool — first token of each item. `hidden` is flat [B, S, D].
pub fn cls_pool(hidden: &[f32], batch_size: usize, dim: usize) -> Vec<f32> {
    let stride_b = hidden.len() / batch_size;
    (0..batch_size)
        .flat_map(|b| hidden[b * stride_b..b * stride_b + dim].iter().copied())
        .collect()
}

pub fn l2_normalize(v: &[f32]) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm < 1e-12 {
        return v.to_vec();
    }
    v.iter().map(|x| x / norm).collect()
}
