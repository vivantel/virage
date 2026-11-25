//! Embedding throughput and thread-count determinism against a real ONNX model.
//!
//! Needs a MiniLM-style model: set `VIRAGE_BENCH_MODEL_DIR` to a directory holding
//! `onnx--model_quantized.onnx` (or `onnx--model.onnx`) and `tokenizer.json`. Run with
//! `cargo test -p virage-engine --release --test embed_throughput -- --ignored --nocapture`.
#![cfg(any(feature = "embedder-onnx", feature = "download-binaries"))]

use std::path::PathBuf;
use std::time::Instant;

use virage_engine::embedders::onnx::OnnxEmbedder;
use virage_engine::embedders::Embedder;
use virage_engine::onnx::{OnnxInferenceSession, Pooling};

const BATCH: usize = 16;

fn model_files() -> Option<(String, String)> {
    let dir = PathBuf::from(std::env::var("VIRAGE_BENCH_MODEL_DIR").ok()?);
    let model = ["onnx--model_quantized.onnx", "onnx--model.onnx"]
        .iter()
        .map(|f| dir.join(f))
        .find(|p| p.exists())?;
    Some((
        model.to_string_lossy().into(),
        dir.join("tokenizer.json").to_string_lossy().into(),
    ))
}

/// Fixed corpus: this crate's own sources cut into ~1500 byte chunks on line boundaries.
fn corpus(max_chunks: usize) -> Vec<String> {
    let mut files: Vec<PathBuf> = Vec::new();
    let mut stack = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "rs") {
                files.push(p);
            }
        }
    }
    files.sort();
    let mut out = Vec::new();
    for f in files {
        let text = std::fs::read_to_string(f).unwrap();
        let mut cur = String::new();
        for line in text.lines() {
            cur.push_str(line);
            cur.push('\n');
            if cur.len() >= 1500 {
                out.push(std::mem::take(&mut cur));
            }
        }
        if !cur.trim().is_empty() {
            out.push(cur);
        }
        if out.len() >= max_chunks {
            break;
        }
    }
    out.truncate(max_chunks);
    out
}

fn embedder(sessions: usize, intra: usize) -> OnnxEmbedder {
    let (m, t) = model_files().expect("VIRAGE_BENCH_MODEL_DIR not set");
    let s = (0..sessions)
        .map(|_| OnnxInferenceSession::from_paths_with_threads(&m, &t, intra).unwrap())
        .collect();
    OnnxEmbedder::with_sessions(s, 384, 512, Pooling::Mean, true)
}

fn run(e: &mut OnnxEmbedder, chunks: &[String]) -> Vec<f32> {
    let mut all = Vec::new();
    for b in chunks.chunks(BATCH) {
        let refs: Vec<&str> = b.iter().map(|s| s.as_str()).collect();
        all.extend(e.embed_batch(&refs).unwrap());
    }
    all
}

#[test]
#[ignore = "needs VIRAGE_BENCH_MODEL_DIR"]
fn throughput_and_determinism_by_session_layout() {
    let chunks = corpus(
        std::env::var("VIRAGE_BENCH_CHUNKS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(96),
    );
    println!("corpus: {} chunks, batch {BATCH}", chunks.len());
    let mut base: Option<Vec<f32>> = None;
    for (sessions, intra) in [(1usize, 1usize), (1, 8), (2, 4), (4, 2), (8, 1)] {
        let threads = format!("{sessions}x{intra}");
        let t0 = Instant::now();
        let mut e = embedder(sessions, intra);
        println!(
            "sessions x threads={threads} session loaded in {:.1}s",
            t0.elapsed().as_secs_f64()
        );
        run(&mut e, &chunks[..BATCH]); // warm-up
        let t = Instant::now();
        let v = run(&mut e, &chunks);
        let s = t.elapsed().as_secs_f64();
        println!(
            "sessions x threads={threads} {:.1} chunks/s ({s:.2} s)",
            chunks.len() as f64 / s
        );
        match &base {
            None => base = Some(v),
            Some(b) => {
                // The model is dynamically quantized, so a vector depends slightly on which other
                // texts share its batch (the pipeline already varies batch size 16 vs 4 under
                // memory pressure). Splitting a batch across sessions must keep every vector
                // pointing the same way: cosine against the single-session run.
                let min_cos = b
                    .chunks(384)
                    .zip(v.chunks(384))
                    .map(|(x, y)| x.iter().zip(y).map(|(p, q)| p * q).sum::<f32>())
                    .fold(1f32, f32::min);
                println!("  min cosine vs 1x1: {min_cos:.5}");
                if sessions == 1 {
                    // Intra-op threads alone must not change a single vector. Several sessions
                    // change batch composition and are opt-in (cosine is printed, not asserted).
                    assert!(min_cos > 0.9999, "threads={threads}: min cosine {min_cos}");
                }
            }
        }
    }
}
