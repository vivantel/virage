use crate::onnx::{OnnxInferenceSession, ScoreActivation};

use super::Reranker;

pub struct CrossEncoderReranker {
    session: OnnxInferenceSession,
    max_length: usize,
    activation: ScoreActivation,
    score_index: usize,
}

impl CrossEncoderReranker {
    pub fn new(
        session: OnnxInferenceSession,
        max_length: usize,
        activation: ScoreActivation,
        score_index: usize,
    ) -> Self {
        Self { session, max_length, activation, score_index }
    }
}

impl Reranker for CrossEncoderReranker {
    fn rerank(&mut self, query: &str, passages: &[&str]) -> Result<Vec<f32>, String> {
        if passages.is_empty() {
            return Ok(vec![]);
        }

        let pairs: Vec<(&str, &str)> = passages.iter().map(|p| (query, *p)).collect();
        let batch = self.session.encode_pair(&pairs, self.max_length)?;
        let (ids_t, mask_t, types_t) = batch.to_tensors()?;

        let outputs = self
            .session
            .session
            .run(ort::inputs![
                "input_ids"      => ids_t,
                "attention_mask" => mask_t,
                "token_type_ids" => types_t,
            ])
            .map_err(|e| format!("ORT cross-encoder inference error: {e}"))?;

        let logits_key = if outputs.contains_key("logits") {
            "logits"
        } else {
            outputs.keys().next().ok_or("cross-encoder model produced no outputs")?
        };

        let (_shape, logits) = outputs[logits_key]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("logits tensor extract error: {e}"))?;

        let num_labels = logits.len() / batch.batch_size;
        let idx = self.score_index.min(num_labels.saturating_sub(1));

        let raw: Vec<f32> =
            (0..batch.batch_size).map(|b| logits[b * num_labels + idx]).collect();

        Ok(match self.activation {
            ScoreActivation::None => raw,
            ScoreActivation::Sigmoid => raw.iter().map(|x| sigmoid(*x)).collect(),
            ScoreActivation::Softmax => (0..batch.batch_size)
                .map(|b| {
                    let row = &logits[b * num_labels..(b + 1) * num_labels];
                    let max = row.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
                    let sum: f32 = row.iter().map(|x| (x - max).exp()).sum();
                    (row[idx] - max).exp() / sum
                })
                .collect(),
        })
    }
}

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}
