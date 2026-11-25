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

/// Per-file chunks with variable sizes (300..1800 bytes, deterministic), standing in for what the AST
/// chunkers produce: many short chunks and a few long ones, grouped by source file.
fn corpus_by_file(max_chunks: usize) -> Vec<Vec<String>> {
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
    let max_bytes: usize = std::env::var("VIRAGE_BENCH_MAXBYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1800);
    let mut seed = 12345u64;
    let (mut out, mut n) = (Vec::new(), 0usize);
    for f in files {
        let text = std::fs::read_to_string(f).unwrap();
        let (mut file_chunks, mut cur) = (Vec::new(), String::new());
        let mut target = 80usize;
        for line in text.lines() {
            cur.push_str(line);
            cur.push('\n');
            if cur.len() >= target {
                file_chunks.push(std::mem::take(&mut cur));
                seed = seed
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                target = 80 + (seed >> 33) as usize % (max_bytes - 80);
            }
        }
        if !cur.trim().is_empty() {
            file_chunks.push(cur);
        }
        n += file_chunks.len();
        out.push(file_chunks);
        if n >= max_chunks {
            break;
        }
    }
    out
}

fn min_cos(a: &[f32], b: &[f32]) -> f32 {
    a.chunks(384)
        .zip(b.chunks(384))
        .map(|(x, y)| x.iter().zip(y).map(|(p, q)| p * q).sum::<f32>())
        .fold(1f32, f32::min)
}

/// Work-reduction steps, one at a time, on the same corpus: padded tokens (load independent), wall time and
/// the cosine of every vector against the current per-file, batch-16 behaviour.
#[test]
#[ignore = "needs VIRAGE_BENCH_MODEL_DIR"]
fn work_reduction_steps() {
    let per_file = corpus_by_file(
        std::env::var("VIRAGE_BENCH_CHUNKS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(200),
    );
    let flat: Vec<&String> = per_file.iter().flatten().collect();
    let (m, t) = model_files().expect("VIRAGE_BENCH_MODEL_DIR not set");
    let probe = OnnxInferenceSession::from_paths_with_threads(&m, &t, 1)
        .unwrap()
        .without_fixed_padding();
    let lens: Vec<usize> = flat
        .iter()
        .map(|s| probe.encode_single(&[s.as_str()], 512).unwrap().seq_len)
        .collect();
    let real: usize = lens.iter().sum();
    println!(
        "corpus: {} chunks in {} files, {} real tokens",
        flat.len(),
        per_file.len(),
        real
    );
    let dup = flat.len() - flat.iter().collect::<std::collections::HashSet<_>>().len();
    println!("exact duplicate texts: {dup}");

    let padded = |order: &[usize], bs: usize, cap: usize| -> usize {
        order
            .chunks(bs)
            .map(|b| b.len() * b.iter().map(|&i| lens[i].min(cap)).max().unwrap())
            .sum()
    };
    // step 0: file order, micro-batches of 16 within each file (today)
    let mut file_batches: Vec<Vec<usize>> = Vec::new();
    let mut idx = 0;
    for f in &per_file {
        let ids: Vec<usize> = (idx..idx + f.len()).collect();
        idx += f.len();
        for b in ids.chunks(16) {
            file_batches.push(b.to_vec());
        }
    }
    let pad0: usize = file_batches
        .iter()
        .map(|b| b.len() * b.iter().map(|&i| lens[i]).max().unwrap())
        .sum();
    let mut sorted: Vec<usize> = (0..flat.len()).collect();
    sorted.sort_by_key(|&i| lens[i]);
    println!("padded tokens: today {pad0}; global length-sorted b16 {}, b32 {}, b64 {}; sorted b16 capped at 256: {}",
        padded(&sorted, 16, 512), padded(&sorted, 32, 512), padded(&sorted, 64, 512), padded(&sorted, 16, 256));

    let mk = |fixed: bool| {
        let sess = OnnxInferenceSession::from_paths_with_threads(&m, &t, 8).unwrap();
        // `fixed` = today's behaviour: the shipped tokenizer.json pads every text to 128 tokens.
        // Not fixed = the tokenizer's padding removed, so each batch pads to its longest text.
        let sess = if fixed {
            sess
        } else {
            sess.without_fixed_padding()
        };
        OnnxEmbedder::with_sessions(vec![sess], 384, 512, Pooling::Mean, true)
    };
    println!("fixed-128 padded tokens today: {}", flat.len() * 128);
    let mut e_old = mk(true);
    let mut e = mk(false);
    let texts: Vec<&str> = flat.iter().map(|s| s.as_str()).collect();
    let run_batches = |e: &mut OnnxEmbedder, batches: &[Vec<usize>]| -> (Vec<f32>, f64) {
        let mut out = vec![0f32; texts.len() * 384];
        let t0 = Instant::now();
        for b in batches {
            let refs: Vec<&str> = b.iter().map(|&i| texts[i]).collect();
            let v = e.embed_batch(&refs).unwrap();
            for (k, &i) in b.iter().enumerate() {
                out[i * 384..(i + 1) * 384].copy_from_slice(&v[k * 384..(k + 1) * 384]);
            }
        }
        (out, t0.elapsed().as_secs_f64())
    };
    run_batches(&mut e_old, &file_batches[..2.min(file_batches.len())]); // warm-up
    run_batches(&mut e, &file_batches[..2.min(file_batches.len())]);
    let (base, tb) = run_batches(&mut e_old, &file_batches);
    println!(
        "today (fixed pad 128, per file, b16): {:.1} chunks/s ({tb:.2} s)",
        texts.len() as f64 / tb
    );
    let (v, s) = run_batches(&mut e, &file_batches);
    println!("step 1 no fixed padding (per file, b16): {:.1} chunks/s ({s:.2} s), min cosine vs today {:.5}", texts.len() as f64 / s, min_cos(&base, &v));
    for bs in [16usize, 32, 64] {
        let batches: Vec<Vec<usize>> = sorted.chunks(bs).map(|c| c.to_vec()).collect();
        let (v, s) = run_batches(&mut e, &batches);
        println!(
            "global sorted, b{bs}:         {:.1} chunks/s ({s:.2} s), min cosine vs today {:.5}",
            texts.len() as f64 / s,
            min_cos(&base, &v)
        );
    }
    // dedupe: embed each distinct text once
    let mut seen = std::collections::HashMap::new();
    let mut uniq: Vec<usize> = Vec::new();
    for (i, s) in texts.iter().enumerate() {
        seen.entry(*s).or_insert_with(|| {
            uniq.push(i);
            i
        });
    }
    let batches: Vec<Vec<usize>> = file_batches
        .iter()
        .map(|b| {
            b.iter()
                .copied()
                .filter(|i| uniq.contains(i))
                .collect::<Vec<_>>()
        })
        .filter(|b: &Vec<usize>| !b.is_empty())
        .collect();
    let (_, s) = run_batches(&mut e, &batches);
    println!(
        "dedupe exact texts (per file): {:.1} chunks/s equivalent ({s:.2} s for {} unique)",
        texts.len() as f64 / s,
        uniq.len()
    );
}
