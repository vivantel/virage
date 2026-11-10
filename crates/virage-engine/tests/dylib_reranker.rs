//! Loads the real `virage-plugin-ort` cdylib through `RerankerDylib` and scores passages with the
//! cross-encoder. Needs the built plugin and network (HuggingFace model download), so it is
//! `#[ignore]`d and run explicitly:
//!
//! ```text
//! cargo build -p virage-plugin-ort
//! VIRAGE_TEST_ORT_PLUGIN=target/debug/libvirage_plugin_ort.so \
//!   cargo test -p virage-engine --no-default-features --features cli-binary-full-dylib \
//!   --test dylib_reranker -- --ignored
//! ```
#![cfg(feature = "embedder-dylib")]

use virage_engine::rerankers::dylib::RerankerDylib;
use virage_engine::rerankers::Reranker;

#[test]
#[ignore = "needs built virage-plugin-ort (VIRAGE_TEST_ORT_PLUGIN) and network"]
fn plugin_cross_encoder_ranks_relevant_passage_first() {
    let plugin = std::env::var("VIRAGE_TEST_ORT_PLUGIN").expect("VIRAGE_TEST_ORT_PLUGIN");
    let cache = std::env::temp_dir().join(format!("virage-rr-test-{}", std::process::id()));
    let cfg = serde_json::json!({
        "model": "Xenova/ms-marco-MiniLM-L-6-v2",
        "cacheDir": cache.to_str().unwrap(),
    })
    .to_string();
    let mut rr = RerankerDylib::open(std::path::Path::new(&plugin), &cfg).expect("open");
    let scores = rr
        .rerank(
            "how do I rotate the signing key",
            &[
                "The cafeteria menu changes every Tuesday.",
                "To rotate the signing key, generate a new keypair and re-mint all tokens.",
            ],
        )
        .expect("rerank");
    assert_eq!(scores.len(), 2);
    assert!(
        scores[1] > scores[0],
        "relevant passage must outrank: {scores:?}"
    );
    assert!(rr.rerank("q", &[]).unwrap().is_empty());
    let _ = std::fs::remove_dir_all(&cache);
}
