//! Pipeline tests on a synthetic corpus and a fake embedder, asserting on the work done (embed
//! calls, texts, tokens, padding share, nothing embedded for unchanged files), never on absolute
//! seconds. The one timing test compares two runs of the same process and tolerates a wide band,
//! so a slow or noisy runner cannot flake it.
//!
//! The corpus is deterministic from a seed: short paragraphs, long paragraphs and a fixed
//! paragraph repeated across files. The fake embedder models a tokenizer that counts one token
//! per 4 bytes, truncates at 128 tokens and pads every row to the longest in its batch, like the
//! shipped MiniLM tokenizer.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::*;
use crate::embedders::{Embedder, TokenStats};
use crate::sources::{ByteRange, ChangedFiles, SourceFilter, SourceItem, SourceProvider};
use crate::stores::{SearchOptions, SearchResult, VectorDocument, VectorStore};

const MAX_TOKENS: u64 = 128;

/// xorshift64*: deterministic, no dependency.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

const DUPLICATE: &str = "This paragraph is copied into every file of the corpus unchanged, \
so a content-hash lookup would embed it once while the pipeline embeds it per file.";

fn words(rng: &mut Rng, target_bytes: usize) -> String {
    let mut s = String::new();
    while s.len() < target_bytes {
        s.push_str(&format!("w{:x} ", rng.below(1 << 20)));
    }
    s
}

/// `files` markdown files; each has short, long and (for every third file) the duplicated paragraph.
fn corpus(seed: u64, files: usize) -> Vec<(String, String)> {
    let mut rng = Rng(seed | 1);
    (0..files)
        .map(|i| {
            let mut body = format!("# File {i}\n\n");
            for _ in 0..(3 + rng.below(4)) {
                let long = rng.below(3) == 0;
                body.push_str(&words(&mut rng, if long { 1800 } else { 40 }));
                body.push_str("\n\n");
            }
            if i % 3 == 0 {
                body.push_str(DUPLICATE);
                body.push_str("\n\n");
            }
            (format!("doc{i:03}.md"), body)
        })
        .collect()
}

struct SyntheticSource {
    files: Vec<(String, String)>,
}

#[async_trait::async_trait]
impl SourceProvider for SyntheticSource {
    fn name(&self) -> &str {
        "synthetic"
    }
    fn provider_type(&self) -> &str {
        "mock"
    }
    async fn current_revision(&self) -> anyhow::Result<String> {
        Ok("rev1".into())
    }
    async fn file_revisions(&self, paths: &[&str]) -> anyhow::Result<HashMap<String, String>> {
        // Stable per content, so an unchanged file keeps its revision between runs.
        Ok(paths
            .iter()
            .map(|p| {
                let len = self
                    .files
                    .iter()
                    .find(|(n, _)| n == p)
                    .map_or(0, |(_, b)| b.len());
                (p.to_string(), format!("len{len}"))
            })
            .collect())
    }
    async fn changed_since(&self, _rev: &str) -> anyhow::Result<Option<ChangedFiles>> {
        Ok(None)
    }
    fn list_all(
        &self,
        _filter: Option<SourceFilter>,
    ) -> futures::stream::BoxStream<'_, anyhow::Result<SourceItem>> {
        let items: Vec<anyhow::Result<SourceItem>> = self
            .files
            .iter()
            .map(|(p, _)| {
                Ok(SourceItem {
                    id: p.clone(),
                    path: p.clone(),
                    provider_name: "synthetic".into(),
                    tags: vec![],
                    meta: HashMap::new(),
                })
            })
            .collect();
        Box::pin(futures::stream::iter(items))
    }
    async fn read_content(
        &self,
        path: &str,
        _range: Option<ByteRange>,
    ) -> anyhow::Result<bytes::Bytes> {
        let body = self
            .files
            .iter()
            .find(|(n, _)| n == path)
            .map(|(_, b)| b.clone())
            .unwrap_or_default();
        Ok(bytes::Bytes::from(body))
    }
}

fn fake_tokens(text: &str) -> u64 {
    (text.len() as u64).div_ceil(4).clamp(1, MAX_TOKENS)
}

/// Counts tokens like a padding tokenizer and optionally charges `cost_per_token` of wall time for
/// every padded token it computes on.
struct FakeEmbedder {
    stats: TokenStats,
    cost_per_token: Duration,
}
impl Embedder for FakeEmbedder {
    fn dimensions(&self) -> usize {
        4
    }
    fn embed_batch(&mut self, texts: &[&str]) -> Result<Vec<f32>, String> {
        let lens: Vec<u64> = texts.iter().map(|t| fake_tokens(t)).collect();
        let longest = lens.iter().copied().max().unwrap_or(0);
        let padded = longest * texts.len() as u64;
        self.stats.real += lens.iter().sum::<u64>();
        self.stats.padded_total += padded;
        if !self.cost_per_token.is_zero() {
            std::thread::sleep(self.cost_per_token * padded as u32);
        }
        Ok(vec![0.1; texts.len() * 4])
    }
    fn token_stats(&self) -> Option<TokenStats> {
        Some(self.stats)
    }
}

#[derive(Default)]
struct RecordingStore {
    docs: Mutex<Vec<VectorDocument>>,
}
#[async_trait::async_trait]
impl VectorStore for RecordingStore {
    async fn initialize(&self) -> anyhow::Result<()> {
        Ok(())
    }
    async fn upsert(&self, docs: &[VectorDocument]) -> anyhow::Result<()> {
        self.docs
            .lock()
            .unwrap()
            .extend(docs.iter().map(|d| VectorDocument {
                id: d.id.clone(),
                dense_text: d.dense_text.clone(),
                sparse_text: d.sparse_text.clone(),
                dense_text_hash: d.dense_text_hash.clone(),
                sparse_text_generator_id: d.sparse_text_generator_id.clone(),
                metadata_generator_id: d.metadata_generator_id.clone(),
                metadata: d.metadata.clone(),
                tags: d.tags.clone(),
                dense_vector: d.dense_vector.clone(),
                source_file: d.source_file.clone(),
                commit_hash: d.commit_hash.clone(),
            }));
        Ok(())
    }
    async fn delete_by_source(&self, _files: &[&str]) -> anyhow::Result<()> {
        Ok(())
    }
    async fn existing_hashes(&self, _hashes: &[&str]) -> anyhow::Result<HashSet<String>> {
        Ok(HashSet::new())
    }
    async fn current_state(&self) -> anyhow::Result<HashMap<String, String>> {
        Ok(HashMap::new())
    }
    async fn search(
        &self,
        _query: &[f32],
        _top_k: usize,
        _opts: SearchOptions,
    ) -> anyhow::Result<Vec<SearchResult>> {
        Ok(Vec::new())
    }
}

async fn run(
    files: Vec<(String, String)>,
    known: HashMap<String, String>,
    cost_per_token: Duration,
) -> (PipelineStats, Arc<RecordingStore>) {
    let store = Arc::new(RecordingStore::default());
    let embedder: Arc<Mutex<dyn Embedder + Send>> = Arc::new(Mutex::new(FakeEmbedder {
        stats: TokenStats::default(),
        cost_per_token,
    }));
    let config = PipelineConfig {
        workers: 2,
        upload_batch_size: 16,
        max_tokens: 512,
        min_tokens: Some(0),
        strategy: "window".into(),
        sparse_text_generator_id: "gen_v1".into(),
        metadata_generator_id: "meta_v1".into(),
        ..Default::default()
    };
    let groups = vec![FileSetGroup {
        source: Arc::new(SyntheticSource { files }),
        filter: None,
        chunkers: vec![],
        tags: vec![],
    }];
    let stats = coordinator::run_pipeline(&config, groups, embedder, store.clone(), known)
        .await
        .unwrap();
    (stats, store)
}

fn work(s: &IndexSummary) -> (u64, u64, u64, Option<u64>) {
    (
        s.embed_calls,
        s.texts_embedded,
        s.bytes_embedded,
        s.tokens_embedded,
    )
}

#[test]
fn the_corpus_is_deterministic_from_its_seed() {
    assert_eq!(corpus(7, 12), corpus(7, 12));
    assert_ne!(corpus(7, 12), corpus(8, 12));
}

#[tokio::test]
async fn every_chunk_is_embedded_once_in_micro_batches() {
    let (stats, store) = run(corpus(1, 12), HashMap::new(), Duration::ZERO).await;
    let docs = store.docs.lock().unwrap();
    let s = &stats.summary;
    assert!(s.chunks_upserted > 12, "corpus produced too few chunks");
    assert_eq!(s.texts_embedded as usize, s.chunks_upserted);
    assert_eq!(docs.len(), s.chunks_upserted);

    let mut per_file: HashMap<&str, u64> = HashMap::new();
    for d in docs.iter() {
        *per_file.entry(d.source_file.as_str()).or_default() += 1;
    }
    let micro = crate::pipeline::worker::EMBED_MICRO_BATCH_SIZE as u64;
    let expected_calls: u64 = per_file.values().map(|n| n.div_ceil(micro)).sum();
    assert_eq!(s.embed_calls, expected_calls);

    let expected_tokens: u64 = docs.iter().map(|d| fake_tokens(&d.dense_text)).sum();
    assert_eq!(s.tokens_embedded, Some(expected_tokens));
    let r = &s.resources;
    let corpus_bytes: u64 = corpus(1, 12).iter().map(|(_, b)| b.len() as u64).sum();
    assert_eq!(r.source_bytes_read, corpus_bytes, "every file is read once");
    assert!(
        r.store_bytes_written >= s.bytes_embedded,
        "stored text plus vectors"
    );
    #[cfg(target_os = "linux")]
    assert!(r.peak_rss_kb.unwrap() > 0 && r.cpu_utilization.is_some());
    let expected_bytes: u64 = docs.iter().map(|d| d.dense_text.len() as u64).sum();
    assert_eq!(s.bytes_embedded, expected_bytes);
}

#[tokio::test]
async fn a_mixed_corpus_wastes_part_of_the_compute_on_padding() {
    let (stats, _) = run(corpus(2, 12), HashMap::new(), Duration::ZERO).await;
    let share = stats
        .summary
        .padded_share
        .expect("fake embedder reports tokens");
    assert!(
        share > 0.05 && share < 1.0,
        "short and long chunks batched together must pad: got {share}"
    );
}

#[test]
fn padded_share_is_the_padding_fraction_of_computed_tokens() {
    let progress = ProgressCounters::default();
    let before = Some(TokenStats {
        real: 100,
        padded_total: 120,
    });
    let after = Some(TokenStats {
        real: 160,
        padded_total: 200,
    });
    let s = summarize(
        &progress,
        0,
        0,
        0,
        before,
        after,
        Duration::ZERO,
        None,
        None,
    );
    assert_eq!(s.tokens_embedded, Some(60));
    // 80 tokens computed this run, 60 of them real.
    assert_eq!(s.padded_share, Some(0.25));
    let none = summarize(&progress, 0, 0, 0, None, None, Duration::ZERO, None, None);
    assert_eq!((none.tokens_embedded, none.padded_share), (None, None));
}

#[tokio::test]
async fn the_same_seed_does_the_same_work() {
    let (a, _) = run(corpus(3, 10), HashMap::new(), Duration::ZERO).await;
    let (b, _) = run(corpus(3, 10), HashMap::new(), Duration::ZERO).await;
    assert_eq!(work(&a.summary), work(&b.summary));
}

#[tokio::test]
async fn unchanged_files_are_not_read_and_nothing_is_stored() {
    let files = corpus(4, 6);
    let (first, _) = run(files.clone(), HashMap::new(), Duration::ZERO).await;
    let (second, _) = run(files, first.processed_revisions.clone(), Duration::ZERO).await;
    assert!(first.summary.resources.source_bytes_read > 0);
    assert_eq!(second.summary.resources.source_bytes_read, 0);
    assert_eq!(second.summary.resources.store_bytes_written, 0);
}

#[tokio::test]
async fn reindexing_unchanged_files_embeds_nothing() {
    let files = corpus(4, 10);
    let (first, _) = run(files.clone(), HashMap::new(), Duration::ZERO).await;
    assert!(first.summary.embed_calls > 0);
    let (second, store) = run(files, first.processed_revisions.clone(), Duration::ZERO).await;
    assert_eq!(second.files_skipped, 10);
    assert_eq!(second.summary.embed_calls, 0);
    assert_eq!(second.summary.texts_embedded, 0);
    assert!(store.docs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_edited_file_is_the_only_one_embedded_again() {
    let mut files = corpus(5, 10);
    let (first, _) = run(files.clone(), HashMap::new(), Duration::ZERO).await;
    files[3].1.push_str("\nOne more line.\n");
    let (second, store) = run(files, first.processed_revisions.clone(), Duration::ZERO).await;
    assert_eq!(second.files_processed, 1);
    assert_eq!(second.files_skipped, 9);
    let docs = store.docs.lock().unwrap();
    assert!(docs.iter().all(|d| d.source_file == "doc003.md"));
}

/// Baseline, not a goal: a paragraph copied into several files is embedded once per file today,
/// because the pipeline never asks the store which hashes it already holds. When a content-hash
/// skip lands this assertion flips to `<`, and that change is the work reduction it claims.
#[tokio::test]
async fn duplicated_content_is_embedded_once_per_copy_today() {
    let (stats, store) = run(corpus(6, 12), HashMap::new(), Duration::ZERO).await;
    let docs = store.docs.lock().unwrap();
    let copies = docs
        .iter()
        .filter(|d| d.dense_text.contains("copied into every file"))
        .count();
    assert!(
        copies >= 4,
        "files 0, 3, 6, 9 carry the duplicate: {copies}"
    );
    assert_eq!(stats.summary.texts_embedded as usize, docs.len());
}

/// Embed time must scale with the work. Both runs happen here, on this runner, so the ratio holds
/// whatever the hardware; the band is wide and the test skips when the smaller run is too short to
/// measure (a fast runner or a clock too coarse to trust).
#[tokio::test]
async fn embed_time_scales_with_the_tokens_computed() {
    let cost = Duration::from_micros(60);
    let (small, _) = run(corpus(9, 8), HashMap::new(), cost).await;
    let (large, _) = run(corpus(9, 24), HashMap::new(), cost).await;
    let (ts, tl) = (small.summary.embed_secs, large.summary.embed_secs);
    if ts < 0.05 {
        eprintln!("skipped: smaller run embedded for {ts}s, below the 0.05s sample guard");
        return;
    }
    let work_ratio = large.summary.texts_embedded as f64 / small.summary.texts_embedded as f64;
    let time_ratio = tl / ts;
    assert!(
        time_ratio > work_ratio * 0.4 && time_ratio < work_ratio * 2.5,
        "time ratio {time_ratio:.2} vs work ratio {work_ratio:.2}"
    );
}

/// Prints the run summary for each corpus size, for reading by a person:
/// `cargo test -p virage-engine --lib --features pipeline report_synthetic -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "prints numbers, asserts nothing"]
async fn report_synthetic_summaries() {
    for (seed, files) in [(1u64, 12usize), (9, 8), (9, 24), (9, 96)] {
        let (stats, _) = run(
            corpus(seed, files),
            HashMap::new(),
            Duration::from_micros(60),
        )
        .await;
        eprintln!("seed={seed} files={files}: {:#?}", stats.summary);
    }
    let files = corpus(4, 24);
    let (first, _) = run(files.clone(), HashMap::new(), Duration::ZERO).await;
    let (again, _) = run(files, first.processed_revisions.clone(), Duration::ZERO).await;
    eprintln!(
        "reindex unchanged: first embed_calls={} texts={}; second embed_calls={} texts={} skipped={}",
        first.summary.embed_calls,
        first.summary.texts_embedded,
        again.summary.embed_calls,
        again.summary.texts_embedded,
        again.files_skipped
    );
}
