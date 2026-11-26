//! The synthetic corpus through real components: files on disk read by the local-fs source, chunked
//! by the real walker, stored by the real LanceDB store. Only the model is modelled: an embedder
//! that burns CPU on several threads and allocates activations in proportion to the padded tokens
//! it is given, so CPU, memory and IO figures are read from a run that really computes, allocates
//! and writes. Without the model the numbers say how the pipeline and store behave, not how fast
//! ONNX is. The report test prints the summary:
//! `cargo test -p virage-engine --lib --features "pipeline,source-localfs,store-lancedb" realistic -- --nocapture`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::synthetic_tests::{corpus, fake_tokens};
use super::*;
use crate::embedders::{Embedder, TokenStats};
use crate::sources::local_fs::LocalFsSourceProvider;
use crate::stores::lancedb::LanceDbStore;

const DIMS: usize = 384;
const THREADS: usize = 4;
/// Multiply-adds per hidden unit per token: sets how heavy a token is.
const WORK_PER_UNIT: usize = 48;

/// Burns CPU on `THREADS` threads and holds `padded_tokens x DIMS` activations per batch.
struct BusyEmbedder {
    stats: TokenStats,
}
impl Embedder for BusyEmbedder {
    fn dimensions(&self) -> usize {
        DIMS
    }
    fn embed_batch(&mut self, texts: &[&str]) -> Result<Vec<f32>, String> {
        let lens: Vec<u64> = texts.iter().map(|t| fake_tokens(t)).collect();
        let longest = lens.iter().copied().max().unwrap_or(0) as usize;
        self.stats.real += lens.iter().sum::<u64>();
        self.stats.padded_total += (longest * texts.len()) as u64;
        let mut activations = vec![0.5f32; longest * texts.len() * DIMS];
        let rows_per = (texts.len() * longest).div_ceil(THREADS).max(1);
        std::thread::scope(|scope| {
            for part in activations.chunks_mut(rows_per * DIMS) {
                scope.spawn(move || {
                    for v in part.iter_mut() {
                        let mut x = *v;
                        for _ in 0..WORK_PER_UNIT {
                            x = x.mul_add(1.000_01, 0.000_1);
                        }
                        *v = x;
                    }
                });
            }
        });
        let mut out = vec![0.0f32; texts.len() * DIMS];
        for (i, row) in out.chunks_mut(DIMS).enumerate() {
            let start = i * longest.max(1) * DIMS;
            row.copy_from_slice(&activations[start..start + DIMS.min(activations.len() - start)]);
        }
        Ok(out)
    }
    fn token_stats(&self) -> Option<TokenStats> {
        Some(self.stats)
    }
}

async fn run_on_disk(
    dir: &std::path::Path,
    store_dir: &std::path::Path,
    embed_across_files: bool,
) -> PipelineStats {
    let store = Arc::new(LanceDbStore::new(
        store_dir.to_string_lossy().to_string(),
        "chunks",
        DIMS,
    ));
    let embedder: Arc<Mutex<dyn Embedder + Send>> = Arc::new(Mutex::new(BusyEmbedder {
        stats: TokenStats::default(),
    }));
    let config = PipelineConfig {
        workers: 4,
        upload_batch_size: 64,
        max_tokens: 512,
        min_tokens: Some(0),
        strategy: "window".into(),
        sparse_text_generator_id: "gen_v1".into(),
        metadata_generator_id: "meta_v1".into(),
        embed_across_files,
        ..Default::default()
    };
    let groups = vec![FileSetGroup {
        source: Arc::new(LocalFsSourceProvider::new(dir, "synthetic")),
        filter: None,
        chunkers: vec![],
        tags: vec![],
    }];
    coordinator::run_pipeline(&config, groups, embedder, store, HashMap::new())
        .await
        .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn real_source_store_and_a_computing_embedder_give_non_trivial_resource_figures() {
    let base = std::env::temp_dir().join(format!("virage-realistic-{}", std::process::id()));
    let (docs, store_dir) = (base.join("docs"), base.join("store"));
    std::fs::create_dir_all(&docs).unwrap();
    let mut corpus_bytes = 0u64;
    for (name, body) in corpus(11, 300) {
        corpus_bytes += body.len() as u64;
        std::fs::write(docs.join(name), body).unwrap();
    }

    let per_file = run_on_disk(&docs, &base.join("store-a"), false).await;
    let across = run_on_disk(&docs, &base.join("store-b"), true).await;
    eprintln!("PER FILE {:#?}", per_file.summary);
    eprintln!("ACROSS FILES {:#?}", across.summary);
    std::fs::remove_dir_all(&base).ok();
    let _ = &store_dir;
    let s = &per_file.summary;
    assert!(across.summary.embed_calls < s.embed_calls);
    assert_eq!(across.summary.texts_embedded, s.texts_embedded);

    assert_eq!(s.files_processed, 300);
    assert_eq!(s.texts_embedded as usize, s.chunks_upserted);
    assert_eq!(s.resources.source_bytes_read, corpus_bytes);
    assert!(s.embed_secs > 0.0);
    #[cfg(target_os = "linux")]
    {
        let r = &s.resources;
        assert!(
            r.cpu_utilization.unwrap() > 0.0 && r.cpu_user_secs.unwrap() > 0.1,
            "a computing embedder must show CPU: {r:?}"
        );
        assert!(
            r.write_syscall_bytes.unwrap() > 0,
            "the store writes to disk: {r:?}"
        );
        assert!(
            r.read_syscall_bytes.unwrap() >= corpus_bytes,
            "the source reads from disk: {r:?}"
        );
    }
}
