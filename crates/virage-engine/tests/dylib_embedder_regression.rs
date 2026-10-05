//! Integration tests for the CE dylib-plugin embedder boundary — the embedder half of IR-050
//! Phase 5's qa-gates checklist (see `dylib_store_regression.rs` for the store half, same
//! checklist entry in `docs/ai/facts/qa-regression-surface.md`).
//!
//! **Scope note, not a silent gap**: unlike the store side, constructing a real
//! `EmbedderDylib` at all requires a real ONNX model + tokenizer (`virage_embedder_create` has no
//! model-free code path) — there's no local-filesystem-only round trip the way
//! `LanceDbStore`/`DylibStore` have one. A real panic-containment test and an index/query-style
//! round-trip-parity test both need a downloaded model in CI (network dependency, materially
//! heavier and more flaky than everything else in this file), so they're deliberately not
//! included here. What *is* covered below (ABI-mismatch rejection, missing-plugin-file) needs no
//! model and is a real, if partial, regression backstop — not a placeholder.

#![cfg(feature = "embedder-dylib")]

use std::path::Path;

use virage_engine::embedders::dylib::EmbedderDylib;

fn bad_abi_plugin_path() -> Option<String> {
    std::env::var("VIRAGE_TEST_BAD_ABI_PLUGIN_PATH").ok()
}

#[test]
fn abi_mismatch_is_rejected_cleanly_not_a_crash() {
    let Some(path) = bad_abi_plugin_path() else {
        eprintln!("skipping: VIRAGE_TEST_BAD_ABI_PLUGIN_PATH not set (plugin fixture not built)");
        return;
    };
    let result = EmbedderDylib::open(Path::new(&path), "{}");
    let err = match result {
        Ok(_) => panic!(
            "loading a plugin compiled against a mismatched PLUGIN_ABI_VERSION must fail \
             cleanly, not succeed or crash the host process"
        ),
        Err(e) => e,
    };
    let msg = err.to_string();
    assert!(
        msg.contains("ABI version mismatch"),
        "expected an ABI-mismatch error message, got: {msg}"
    );
}

#[test]
fn missing_plugin_file_is_a_clean_error_not_a_crash_or_confusing_message() {
    let missing = std::env::temp_dir().join(format!(
        "virage-dylib-embedder-test-definitely-missing-{}.so",
        std::process::id()
    ));
    assert!(
        !missing.exists(),
        "test precondition violated: {missing:?} unexpectedly exists"
    );

    let result = EmbedderDylib::open(&missing, "{}");
    let err = match result {
        Ok(_) => {
            panic!("opening an embedder against a nonexistent plugin path must fail, not succeed")
        }
        Err(e) => e,
    };
    let msg = err.to_string();
    assert!(
        msg.contains("Cannot load embedder plugin"),
        "expected a clean 'Cannot load embedder plugin' message naming the missing path, got: {msg}"
    );
    assert!(
        msg.contains(&missing.to_string_lossy().into_owned()),
        "expected the error to name the actual path that was missing, got: {msg}"
    );
}
