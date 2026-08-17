//! Integration tests for the CE dylib-plugin store boundary — the "CE dylib-plugin dev-loop
//! boundary" checklist gating IR-051's `Accepted` → `Current` promotion (panic containment,
//! concurrent-access correctness, ABI-mismatch rejection, index/query round-trip parity).
//!
//! These need real compiled `cdylib` artifacts this crate's own `cargo test` doesn't produce.
//! Each test looks for its plugin path via an env var and prints a skip message (not a failure)
//! if unset, so `cargo test` still passes in an environment that hasn't built the plugins — CI
//! builds `virage-plugin-lancedb` and `virage-plugin-test-fixture-bad-abi` as separate steps
//! first and sets these before running this file.

#![cfg(all(feature = "store-dylib", feature = "store-lancedb"))]

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use virage_engine::stores::dylib::DylibStore;
use virage_engine::stores::lancedb::LanceDbStore;
use virage_engine::stores::{SearchOptions, VectorDocument, VectorStore};

fn lancedb_plugin_path() -> Option<String> {
    std::env::var("VIRAGE_TEST_LANCEDB_PLUGIN_PATH").ok()
}

fn bad_abi_plugin_path() -> Option<String> {
    std::env::var("VIRAGE_TEST_BAD_ABI_PLUGIN_PATH").ok()
}

/// A unique-enough temp dir per test, without adding a `tempfile` dev-dependency for one use.
fn unique_temp_dir(label: &str) -> PathBuf {
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before UNIX epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("virage-dylib-store-test-{label}-{pid}-{nanos}"))
}

fn sample_doc(id: &str, text: &str, vector: Vec<f32>) -> VectorDocument {
    VectorDocument {
        id: id.to_string(),
        dense_text: text.to_string(),
        sparse_text: text.to_string(),
        dense_text_hash: id.to_string(),
        sparse_text_generator_id: "test".to_string(),
        metadata_generator_id: "test".to_string(),
        metadata: HashMap::new(),
        tags: vec![],
        dense_vector: vector,
        source_file: "test.md".to_string(),
        commit_hash: "abc123".to_string(),
    }
}

const DIMS: usize = 3;

fn config_json(uri: &Path) -> String {
    format!(
        r#"{{"uri":"{}","table_name":"virage_chunks","dimensions":{DIMS}}}"#,
        uri.display()
    )
}

// ─── Check 1: ABI-mismatch rejection ───────────────────────────────────────────

#[tokio::test]
async fn abi_mismatch_is_rejected_cleanly_not_a_crash() {
    let Some(path) = bad_abi_plugin_path() else {
        eprintln!("skipping: VIRAGE_TEST_BAD_ABI_PLUGIN_PATH not set (plugin fixture not built)");
        return;
    };
    let result = DylibStore::open(Path::new(&path), "{}");
    // Not .expect_err(): DylibStore doesn't implement Debug (it holds a loaded libloading::Library
    // and raw fn pointers, nothing meaningfully Debug-able), which expect_err requires for its
    // own panic message on the Ok path.
    let err = match result {
        Ok(_) => panic!(
            "loading a plugin compiled against a mismatched PLUGIN_ABI_VERSION must fail \
             cleanly, not succeed or crash the host process"
        ),
        Err(e) => e,
    };
    let msg = err.to_string();
    // Deliberately specific, not `|| msg.contains("Cannot load")` — that broader OR would also
    // match a plain file-not-found error (a different failure mode this test isn't exercising),
    // silently passing for the wrong reason if the plugin path were ever misconfigured.
    assert!(
        msg.contains("ABI version mismatch"),
        "expected an ABI-mismatch error message, got: {msg}"
    );
}

// ─── Check 2: panic containment ────────────────────────────────────────────────

#[tokio::test]
async fn panic_inside_plugin_is_contained_not_a_host_crash() {
    let Some(path) = lancedb_plugin_path() else {
        eprintln!("skipping: VIRAGE_TEST_LANCEDB_PLUGIN_PATH not set (plugin not built)");
        return;
    };
    let dir = unique_temp_dir("panic-containment");
    let store = DylibStore::open(Path::new(&path), &config_json(&dir))
        .expect("failed to open dylib store for panic-containment test");
    store.initialize().await.expect("initialize failed");

    // The process reaching this line at all after a search that triggers a real panic inside the
    // plugin's extern "C" export is the actual assertion — a genuinely uncontained panic across
    // an FFI boundary aborts the whole process, which would make this test (and every test after
    // it in the same binary) simply never report a result rather than fail normally.
    let opts = SearchOptions {
        query_text: Some("__VIRAGE_TEST_TRIGGER_PANIC__".to_string()),
        ..SearchOptions::default()
    };
    let result = store.search(&[0.0; DIMS], 5, opts).await;
    // Not .expect_err(): SearchResult (inside the Ok(Vec<SearchResult>) side) doesn't implement
    // Debug either.
    let err = match result {
        Ok(_) => panic!("a deliberately panicking plugin call must surface as an Err"),
        Err(e) => e,
    };
    assert!(
        err.to_string().contains("panicked"),
        "expected a 'plugin panicked' error message, got: {err}"
    );

    // The handle must still be usable after a contained panic — a real search should still work.
    let ok = store
        .search(&[0.0; DIMS], 5, SearchOptions::default())
        .await;
    assert!(
        ok.is_ok(),
        "store should still be usable after a contained panic, got: {:?}",
        ok.err()
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// ─── Check 3: index/query round-trip parity ────────────────────────────────────

#[tokio::test]
async fn dylib_store_round_trip_matches_static_lancedb_store() {
    let Some(path) = lancedb_plugin_path() else {
        eprintln!("skipping: VIRAGE_TEST_LANCEDB_PLUGIN_PATH not set (plugin not built)");
        return;
    };

    let docs = vec![
        sample_doc("doc-1", "the quick brown fox", vec![1.0, 0.0, 0.0]),
        sample_doc("doc-2", "jumps over the lazy dog", vec![0.0, 1.0, 0.0]),
    ];

    // Static path — the existing, already-proven implementation.
    let static_dir = unique_temp_dir("parity-static");
    let static_store = LanceDbStore::new(static_dir.to_string_lossy(), "virage_chunks", DIMS);
    static_store.initialize().await.expect("static initialize");
    static_store.upsert(&docs).await.expect("static upsert");
    let static_results = static_store
        .search(&[1.0, 0.0, 0.0], 2, SearchOptions::default())
        .await
        .expect("static search");

    // Dylib path — same operations, through the FFI boundary.
    let dylib_dir = unique_temp_dir("parity-dylib");
    let dylib_store = DylibStore::open(Path::new(&path), &config_json(&dylib_dir))
        .expect("failed to open dylib store for parity test");
    dylib_store.initialize().await.expect("dylib initialize");
    dylib_store.upsert(&docs).await.expect("dylib upsert");
    let dylib_results = dylib_store
        .search(&[1.0, 0.0, 0.0], 2, SearchOptions::default())
        .await
        .expect("dylib search");

    assert_eq!(
        static_results.len(),
        dylib_results.len(),
        "static and dylib paths returned a different number of results"
    );
    let static_ids: Vec<&str> = static_results.iter().map(|r| r.id.as_str()).collect();
    let dylib_ids: Vec<&str> = dylib_results.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(
        static_ids, dylib_ids,
        "static and dylib paths returned results in a different order/identity"
    );
    for (s, d) in static_results.iter().zip(dylib_results.iter()) {
        assert!(
            (s.similarity - d.similarity).abs() < 1e-4,
            "similarity mismatch for {:?}: static={} dylib={}",
            s.id,
            s.similarity,
            d.similarity
        );
    }

    let _ = std::fs::remove_dir_all(&static_dir);
    let _ = std::fs::remove_dir_all(&dylib_dir);
}

// ─── Check 4: concurrent-access correctness ────────────────────────────────────

#[tokio::test]
async fn concurrent_searches_against_one_handle_do_not_corrupt_results() {
    let Some(path) = lancedb_plugin_path() else {
        eprintln!("skipping: VIRAGE_TEST_LANCEDB_PLUGIN_PATH not set (plugin not built)");
        return;
    };
    let dir = unique_temp_dir("concurrency");
    let store = std::sync::Arc::new(
        DylibStore::open(Path::new(&path), &config_json(&dir))
            .expect("failed to open dylib store for concurrency test"),
    );
    store.initialize().await.expect("initialize failed");
    let docs = vec![
        sample_doc("c-doc-1", "alpha", vec![1.0, 0.0, 0.0]),
        sample_doc("c-doc-2", "beta", vec![0.0, 1.0, 0.0]),
        sample_doc("c-doc-3", "gamma", vec![0.0, 0.0, 1.0]),
    ];
    store.upsert(&docs).await.expect("upsert failed");

    const CONCURRENT_CALLS: usize = 16;
    let mut handles = Vec::with_capacity(CONCURRENT_CALLS);
    for i in 0..CONCURRENT_CALLS {
        let store = store.clone();
        // Round-robin through the three known vectors so every result set should contain exactly
        // the doc whose vector this call queried with, as the top hit.
        let query = match i % 3 {
            0 => [1.0, 0.0, 0.0],
            1 => [0.0, 1.0, 0.0],
            _ => [0.0, 0.0, 1.0],
        };
        let expected_top = match i % 3 {
            0 => "c-doc-1",
            1 => "c-doc-2",
            _ => "c-doc-3",
        };
        handles.push(tokio::spawn(async move {
            let results = store
                .search(&query, 1, SearchOptions::default())
                .await
                .expect("concurrent search failed");
            assert_eq!(results.len(), 1, "expected exactly one result");
            assert_eq!(
                results[0].id, expected_top,
                "concurrent call {i} got a mismatched top result — possible cross-call corruption"
            );
        }));
    }
    for h in handles {
        h.await.expect("concurrent search task panicked");
    }

    let _ = std::fs::remove_dir_all(&dir);
}
