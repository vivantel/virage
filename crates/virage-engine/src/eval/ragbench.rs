//! RAGBench HuggingFace integration — IR-038 Step 5.
//!
//! For each `galileo-ai/ragbench` subset:
//!   1. Download queries via HuggingFace's Datasets Server rows API (JSON; see the 2026-07-30
//!      correction in `docs/decisions/IR-038-eval-quality-bench-redesign.md` — the dataset
//!      repo's raw files are Parquet, not plain files, so the rows API is used instead of a
//!      raw-file download).
//!   2. Pool all unique documents across every query into a per-subset corpus.
//!   3. Embed the corpus with the configured embedder and hold it in memory.
//!   4. For each query: embed the question, search top-K by cosine similarity, measure
//!      retrieval quality against `all_relevant_sentence_keys`.
//!
//! Ported from `dist/eval/ragbench-hf.js`. The in-memory store uses exact cosine similarity —
//! appropriate for the small corpus sizes here (a few hundred unique docs per subset).

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::embedders::Embedder;

use super::metrics::{hit_rate_at_k, ndcg_at_k, recall_at_k, reciprocal_rank};
use super::SubsetResult;

pub const HF_RAGBENCH_SUBSETS: &[&str] = &[
    "covidqa",
    "cuad",
    "delucionqa",
    "emanual",
    "expertqa",
    "finqa",
    "hagrid",
    "hotpotqa",
    "msmarco",
    "pubmedqa",
    "tatqa",
    "techqa",
];

const HF_ROWS_URL: &str = "https://datasets-server.huggingface.co/rows";
const HF_DATASET: &str = "galileo-ai/ragbench";

async fn fetch_page(
    client: &reqwest::Client,
    subset: &str,
    offset: usize,
    length: usize,
) -> anyhow::Result<(Vec<Value>, usize)> {
    let resp = client
        .get(HF_ROWS_URL)
        .query(&[
            ("dataset", HF_DATASET),
            ("config", subset),
            ("split", "test"),
            ("offset", &offset.to_string()),
            ("length", &length.to_string()),
        ])
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("HuggingFace Datasets Server request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("HuggingFace Datasets Server error {status} for subset {subset:?}: {body}");
    }
    let data: Value = resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("HuggingFace Datasets Server response parse error: {e}"))?;
    let rows = data["rows"].as_array().cloned().unwrap_or_default();
    let total = data["num_rows_total"].as_u64().unwrap_or(0) as usize;
    Ok((rows, total))
}

async fn download_subset(
    client: &reqwest::Client,
    subset: &str,
    max_rows: usize,
) -> anyhow::Result<Vec<Value>> {
    let page_size = max_rows.min(100);
    let (first_rows, total) = fetch_page(client, subset, 0, page_size).await?;
    let mut rows = first_rows;
    let target = max_rows.min(total);
    while rows.len() < target {
        let remaining = target - rows.len();
        let (page, _) = fetch_page(client, subset, rows.len(), remaining.min(100)).await?;
        if page.is_empty() {
            break;
        }
        rows.extend(page);
    }
    Ok(rows)
}

fn content_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

struct RagBenchRow {
    question: String,
    documents: Vec<String>,
    relevant_sentence_keys: Vec<String>,
}

fn parse_row(raw: &Value) -> Option<RagBenchRow> {
    let row = raw.get("row")?;
    let question = row.get("question")?.as_str()?.to_string();
    let documents: Vec<String> = row
        .get("documents")?
        .as_array()?
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    let relevant_sentence_keys: Vec<String> = row
        .get("all_relevant_sentence_keys")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    Some(RagBenchRow {
        question,
        documents,
        relevant_sentence_keys,
    })
}

/// Extract the referenced document indices from `all_relevant_sentence_keys` (e.g. `"0a"` →
/// document index 0) and map them to this row's document content hashes.
fn relevant_doc_ids(row: &RagBenchRow) -> HashSet<String> {
    let mut doc_indices = HashSet::new();
    for key in &row.relevant_sentence_keys {
        let digits: String = key.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(idx) = digits.parse::<usize>() {
            doc_indices.insert(idx);
        }
    }
    doc_indices
        .into_iter()
        .filter(|&i| i < row.documents.len())
        .map(|i| content_hash(&row.documents[i]))
        .collect()
}

fn cosine_sim(a: &[f32], b: &[f32]) -> f64 {
    let mut dot = 0.0f64;
    let mut na = 0.0f64;
    let mut nb = 0.0f64;
    for (x, y) in a.iter().zip(b) {
        dot += (*x as f64) * (*y as f64);
        na += (*x as f64) * (*x as f64);
        nb += (*y as f64) * (*y as f64);
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

struct InMemStore {
    entries: Vec<(String, Vec<f32>)>,
}

impl InMemStore {
    fn search(&self, query: &[f32], k: usize) -> Vec<String> {
        let mut scored: Vec<(f64, &str)> = self
            .entries
            .iter()
            .map(|(id, vec)| (cosine_sim(query, vec), id.as_str()))
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored
            .into_iter()
            .take(k)
            .map(|(_, id)| id.to_string())
            .collect()
    }
}

fn embed_texts(
    embedder: &Mutex<dyn Embedder + Send>,
    texts: &[String],
) -> anyhow::Result<Vec<Vec<f32>>> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let text_refs: Vec<&str> = texts.iter().map(String::as_str).collect();
    let mut guard = embedder
        .lock()
        .map_err(|_| anyhow::anyhow!("embedder lock poisoned"))?;
    let dims = guard.dimensions();
    let flat = guard
        .embed_batch(&text_refs)
        .map_err(|e| anyhow::anyhow!("embed error: {e}"))?;
    Ok(flat.chunks(dims).map(|c| c.to_vec()).collect())
}

async fn eval_subset(
    embedder: &Mutex<dyn Embedder + Send>,
    rows: &[RagBenchRow],
    subset: &str,
    top_k: usize,
) -> anyhow::Result<SubsetResult> {
    // Build deduped corpus.
    let mut corpus: HashMap<String, String> = HashMap::new();
    for row in rows {
        for doc in &row.documents {
            corpus
                .entry(content_hash(doc))
                .or_insert_with(|| doc.clone());
        }
    }
    let corpus_ids: Vec<String> = corpus.keys().cloned().collect();
    let corpus_texts: Vec<String> = corpus_ids.iter().map(|id| corpus[id].clone()).collect();
    let corpus_vecs = embed_texts(embedder, &corpus_texts)?;
    let store = InMemStore {
        entries: corpus_ids.into_iter().zip(corpus_vecs).collect(),
    };

    let mut mrr_scores = Vec::new();
    let mut ndcg_scores = Vec::new();
    let mut recall_scores = Vec::new();
    let mut hit_rate_scores = Vec::new();

    for row in rows {
        let relevant = relevant_doc_ids(row);
        if relevant.is_empty() {
            continue;
        }
        let query_vecs = embed_texts(embedder, std::slice::from_ref(&row.question))?;
        let Some(query_vec) = query_vecs.into_iter().next() else {
            continue;
        };
        let results = store.search(&query_vec, top_k);

        mrr_scores.push(reciprocal_rank(&results, &relevant));
        ndcg_scores.push(ndcg_at_k(&results, &relevant, top_k));
        recall_scores.push(recall_at_k(&results, &relevant, top_k));
        hit_rate_scores.push(hit_rate_at_k(&results, &relevant, top_k));
    }

    let avg = |arr: &[f64]| {
        if arr.is_empty() {
            0.0
        } else {
            arr.iter().sum::<f64>() / arr.len() as f64
        }
    };

    Ok(SubsetResult {
        subset: subset.to_string(),
        corpus_size: corpus.len(),
        queries_evaluated: mrr_scores.len(),
        top_k,
        mrr_at_k: avg(&mrr_scores),
        ndcg_at_k: avg(&ndcg_scores),
        recall_at_k: avg(&recall_scores),
        hit_rate_at_k: avg(&hit_rate_scores),
        per_query_rr: mrr_scores,
    })
}

/// Run the RAGBench eval for one or more subsets, returning one `SubsetResult` per subset.
pub async fn run_subsets(
    embedder: &Mutex<dyn Embedder + Send>,
    subsets: &[String],
    max_rows_per_subset: usize,
    top_k: usize,
) -> anyhow::Result<Vec<SubsetResult>> {
    let client = reqwest::Client::builder()
        .user_agent("virage-eval/1.0")
        .build()
        .map_err(|e| anyhow::anyhow!("failed to build HTTP client: {e}"))?;

    let mut results = Vec::with_capacity(subsets.len());
    for subset in subsets {
        let raw_rows = download_subset(&client, subset, max_rows_per_subset).await?;
        let rows: Vec<RagBenchRow> = raw_rows.iter().filter_map(parse_row).collect();
        results.push(eval_subset(embedder, &rows, subset, top_k).await?);
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relevant_doc_ids_maps_leading_digits_to_content_hash() {
        let row = RagBenchRow {
            question: "q".to_string(),
            documents: vec!["doc zero".to_string(), "doc one".to_string()],
            relevant_sentence_keys: vec!["0a".to_string(), "1b".to_string(), "5z".to_string()],
        };
        let ids = relevant_doc_ids(&row);
        // Index 5 is out of range and must be dropped, not panic.
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&content_hash("doc zero")));
        assert!(ids.contains(&content_hash("doc one")));
    }

    #[test]
    fn parse_row_handles_missing_optional_keys() {
        let raw: Value = serde_json::json!({
            "row": {
                "question": "what?",
                "documents": ["a", "b"],
            }
        });
        let row = parse_row(&raw).unwrap();
        assert_eq!(row.question, "what?");
        assert_eq!(row.documents.len(), 2);
        assert!(row.relevant_sentence_keys.is_empty());
    }

    #[test]
    fn parse_row_none_when_question_missing() {
        let raw: Value = serde_json::json!({ "row": { "documents": [] } });
        assert!(parse_row(&raw).is_none());
    }

    #[test]
    fn store_search_returns_closest_first() {
        let store = InMemStore {
            entries: vec![
                ("far".to_string(), vec![0.0, 1.0]),
                ("near".to_string(), vec![1.0, 0.0]),
            ],
        };
        let results = store.search(&[1.0, 0.0], 1);
        assert_eq!(results, vec!["near".to_string()]);
    }
}
