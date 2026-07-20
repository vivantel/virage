use super::*;
use crate::plugins::wasm::chunker::WasmChunkerAdapter;

// Fixtures compiled from virage-engine-sdk examples (release build, wasm32-wasip2).
// Rebuild: cargo build -p virage-engine-sdk --example plain-text-chunker --example sandbox-probe \
//          --target wasm32-wasip2 --release
const PLAIN_TEXT_CHUNKER: &[u8] = include_bytes!("../../../tests/fixtures/plain-text-chunker.wasm");
const SANDBOX_PROBE: &[u8] = include_bytes!("../../../tests/fixtures/sandbox-probe.wasm");

fn make_registry() -> WasmRegistry {
    let host = WasmPluginHost::new().expect("WasmPluginHost::new");
    WasmRegistry::new(host)
}

// ── Functional: plain-text chunker splits on blank lines ─────────────────────

#[test]
fn functional_plain_text_chunker_splits_paragraphs() {
    let registry = make_registry();
    let adapter =
        WasmChunkerAdapter::from_bytes(&registry, "plain-text-chunker", PLAIN_TEXT_CHUNKER, "{}")
            .expect("load plain-text-chunker");

    let info = FileInfo {
        path: "test.txt".to_string(),
        hash: "abc123".to_string(),
        size: 100,
        modified_ms: 0,
    };

    let body = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    let doc_json = adapter.parse(&info, body.as_bytes()).expect("parse");
    let chunks = adapter.chunk(&doc_json, &info, "deadbeef").expect("chunk");

    assert_eq!(
        chunks.len(),
        3,
        "expected 3 paragraphs, got {} chunks: {:?}",
        chunks.len(),
        chunks.iter().map(|c| &c.dense_text).collect::<Vec<_>>()
    );

    assert!(chunks[0].dense_text.contains("First paragraph."));
    assert!(chunks[1].dense_text.contains("Second paragraph."));
    assert!(chunks[2].dense_text.contains("Third paragraph."));

    // Verify all chunks have required fields
    for chunk in &chunks {
        assert!(
            !chunk.dense_text_hash.is_empty(),
            "dense_text_hash must be set"
        );
        assert_eq!(chunk.source_file, "test.txt");
        assert_eq!(chunk.commit_hash, "deadbeef");
    }
}

#[test]
fn functional_empty_input_produces_no_chunks() {
    let registry = make_registry();
    let adapter =
        WasmChunkerAdapter::from_bytes(&registry, "plain-text-chunker", PLAIN_TEXT_CHUNKER, "{}")
            .expect("load");

    let info = FileInfo {
        path: "empty.txt".to_string(),
        hash: "0".to_string(),
        size: 0,
        modified_ms: 0,
    };

    let doc_json = adapter.parse(&info, b"").expect("parse");
    let chunks = adapter.chunk(&doc_json, &info, "").expect("chunk");
    assert!(chunks.is_empty(), "empty input should produce no chunks");
}

// ── Sandbox: FS access denied when no preopened directories ──────────────────

#[test]
fn sandbox_fs_access_denied() {
    let registry = make_registry();
    let adapter = WasmChunkerAdapter::from_bytes(&registry, "sandbox-probe", SANDBOX_PROBE, "{}")
        .expect("load sandbox-probe");

    let info = FileInfo {
        path: "probe.txt".to_string(),
        hash: "0".to_string(),
        size: 0,
        modified_ms: 0,
    };

    // The sandbox-probe plugin attempts to read /etc/passwd in parse().
    // With no preopened directories, it should get an OS error (not data).
    let doc_json = adapter.parse(&info, b"probe").expect("parse completed");
    let chunks = adapter.chunk(&doc_json, &info, "").expect("chunk");

    // The probe encodes the result in the first chunk's dense_text:
    // "FS_ACCESS_DENIED:<error>" or "FS_ACCESS_GRANTED:<len>"
    assert_eq!(chunks.len(), 1);
    let result = &chunks[0].dense_text;
    assert!(
        result.starts_with("FS_ACCESS_DENIED:"),
        "WASI sandbox must deny FS access, but got: {:?}",
        result
    );
    assert!(
        !result.starts_with("FS_ACCESS_GRANTED:"),
        "SECURITY: plugin was able to read /etc/passwd — sandbox broken! result: {:?}",
        result
    );
}

// ── Memory: peak RSS < 50 MB for a loaded module ─────────────────────────────

#[test]
fn memory_peak_rss_under_50mb_per_module() {
    // Read RSS before loading the module.
    let rss_before = read_rss_kb();

    let registry = make_registry();
    let _adapter =
        WasmChunkerAdapter::from_bytes(&registry, "plain-text-chunker", PLAIN_TEXT_CHUNKER, "{}")
            .expect("load");

    let rss_after = read_rss_kb();
    let delta_mb = (rss_after.saturating_sub(rss_before)) / 1024;

    assert!(
        delta_mb < 50,
        "peak RSS increased by {delta_mb} MB after loading 1 WASM module (limit: 50 MB)"
    );
}

/// Read the current process RSS in kilobytes from /proc/self/status (Linux only).
fn read_rss_kb() -> u64 {
    #[cfg(target_os = "linux")]
    {
        let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
        for line in status.lines() {
            if let Some(rest) = line.strip_prefix("VmRSS:") {
                return rest
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
            }
        }
    }
    0
}
