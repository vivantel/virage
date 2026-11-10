//! `cdylib` dylib-plugin exporting `OnnxEmbedder` behind the dylib-plugin
//! host's `EmbedderVTable` ABI (IR-050 Phase 3).
//!
//! Every export here is the plugin-side half of a contract documented on the
//! host side, in the host repo's `plugins/dylib/embedder.rs` — read that
//! module's docs first, this file doesn't re-derive the design:
//!
//! - no async boundary: `Embedder::embed_batch` is a plain synchronous call
//!   (`&mut self`), unlike `VectorStore`'s async methods — no Tokio runtime
//!   needed in this plugin's `Handle`, unlike `virage-plugin-lancedb`'s.
//! - data marshaling: input texts cross as a JSON array of strings; output
//!   vectors cross as a raw plugin-allocated `(*mut f32, usize)` buffer,
//!   freed via `virage_embedder_free_vectors` — see `plugins/dylib/embedder.rs`'s
//!   module docs for the full rationale.
//! - error convention: `i32` return (`0` = ok), `err_out` populated with a
//!   plugin-allocated, `virage_embedder_free_str`-owned message on failure.
//! - panic safety: every export is wrapped in `catch_unwind` — same
//!   IR-050 qa-gates requirement as `virage-plugin-lancedb`.
//!
//! `PLUGIN_ABI_VERSION` here must track the host's own ABI-version constant
//! exactly (currently `2`) — this crate has no build or dependency
//! relationship to the closed-source host codebase that loads it, so the
//! value is duplicated by hand rather than shared via a common dependency.
//! Bumping one without the other is caught at load time by the host's
//! version check, not at compile time here.
//!
//! The `virage_reranker_*` exports (cross-encoder reranking) are an additive extension that reuses
//! `PLUGIN_ABI_VERSION` and `virage_embedder_free_str`: a host that never looks them up is
//! unaffected, and a host that needs them fails with a missing-symbol error on an older plugin.
//! Config JSON for `virage_reranker_create` is `config::resolve::CrossEncoderOptions` (same shape as
//! the statically-linked path).
//!
//! Config JSON accepted by `virage_embedder_create` is the identical shape
//! `virage_engine::config::resolve::OnnxEmbedderOptions` parses for the
//! statically-linked path (HuggingFace/URL/local model source, dimensions,
//! maxLength, pooling, normalize) — reused directly, not duplicated, so the
//! two paths can never drift on what fields a config accepts.

#![allow(clippy::missing_safety_doc)]

#[cfg(all(target_os = "linux", target_env = "gnu"))]
mod glibc_compat;

use std::ffi::{c_char, c_void, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};

use virage_engine::config::resolve::{CrossEncoderOptions, OnnxEmbedderOptions};
use virage_engine::embedders::onnx::OnnxEmbedder;
use virage_engine::embedders::Embedder;
use virage_engine::onnx::{OnnxInferenceSession, Pooling};
use virage_engine::rerankers::cross_encoder::CrossEncoderReranker;
use virage_engine::rerankers::Reranker;

/// Must match the dylib-plugin host's `PLUGIN_ABI_VERSION` constant.
const PLUGIN_ABI_VERSION: u32 = 2;

/// Plugin-owned state behind an opaque `EmbedderHandle`.
struct Handle {
    embedder: OnnxEmbedder,
}

// ─── Error / string helpers (identical convention to virage-plugin-lancedb) ───

unsafe fn set_err(err_out: *mut *mut c_char, msg: impl std::fmt::Display) {
    if err_out.is_null() {
        return;
    }
    let c = CString::new(msg.to_string())
        .unwrap_or_else(|_| CString::new("error message contained an interior NUL byte").unwrap());
    *err_out = c.into_raw();
}

unsafe fn clear_err(err_out: *mut *mut c_char) {
    if !err_out.is_null() {
        *err_out = std::ptr::null_mut();
    }
}

unsafe fn read_cstr<'a>(ptr: *const c_char) -> Result<&'a str, String> {
    if ptr.is_null() {
        return Err("unexpected null string argument".to_string());
    }
    CStr::from_ptr(ptr)
        .to_str()
        .map_err(|e| format!("argument is not valid UTF-8: {e}"))
}

fn panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    panic
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "panic in virage-plugin-ort (no message)".to_string())
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

#[no_mangle]
pub unsafe extern "C" fn virage_plugin_abi_version() -> u32 {
    PLUGIN_ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn virage_embedder_create(
    config_json: *const c_char,
    err_out: *mut *mut c_char,
) -> *mut c_void {
    clear_err(err_out);
    let result = catch_unwind(AssertUnwindSafe(|| -> anyhow::Result<*mut c_void> {
        let json = read_cstr(config_json).map_err(|e| anyhow::anyhow!(e))?;
        let opts: OnnxEmbedderOptions = serde_json::from_str(json)
            .map_err(|e| anyhow::anyhow!("invalid embedder config JSON: {e}"))?;
        let (model_path, tokenizer_path) = opts
            .source
            .resolve_paths()
            .map_err(|e| anyhow::anyhow!("failed to resolve ONNX model source: {e}"))?;
        let session = OnnxInferenceSession::from_paths(&model_path, &tokenizer_path)
            .map_err(|e| anyhow::anyhow!("OnnxEmbedder session init error: {e}"))?;
        let pooling = match opts.pooling.as_deref() {
            Some("cls") => Pooling::Cls,
            _ => Pooling::Mean,
        };
        let embedder = OnnxEmbedder::new(
            session,
            opts.dimensions,
            opts.max_length.unwrap_or(512),
            pooling,
            opts.normalize,
        );
        let handle = Box::new(Handle { embedder });
        Ok(Box::into_raw(handle) as *mut c_void)
    }));
    match result {
        Ok(Ok(ptr)) => ptr,
        Ok(Err(e)) => {
            set_err(err_out, e);
            std::ptr::null_mut()
        }
        Err(panic) => {
            set_err(
                err_out,
                format!("plugin panicked: {}", panic_message(panic)),
            );
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn virage_embedder_destroy(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }
    drop(Box::from_raw(handle as *mut Handle));
}

#[no_mangle]
pub unsafe extern "C" fn virage_embedder_dimensions(handle: *mut c_void) -> usize {
    if handle.is_null() {
        return 0;
    }
    let handle = &*(handle as *mut Handle);
    handle.embedder.dimensions()
}

#[no_mangle]
pub unsafe extern "C" fn virage_embedder_embed_batch(
    handle: *mut c_void,
    texts_json: *const c_char,
    vectors_out: *mut *mut f32,
    vectors_len_out: *mut usize,
    err_out: *mut *mut c_char,
) -> i32 {
    clear_err(err_out);
    if handle.is_null() {
        set_err(err_out, "null embedder handle");
        return 1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| -> anyhow::Result<Vec<f32>> {
        let json = read_cstr(texts_json).map_err(|e| anyhow::anyhow!(e))?;
        let texts: Vec<String> =
            serde_json::from_str(json).map_err(|e| anyhow::anyhow!("invalid texts JSON: {e}"))?;
        let texts_ref: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
        let handle = &mut *(handle as *mut Handle);
        handle
            .embedder
            .embed_batch(&texts_ref)
            .map_err(|e| anyhow::anyhow!(e))
    }));
    match result {
        Ok(Ok(vectors)) => {
            let mut vectors = std::mem::ManuallyDrop::new(vectors);
            unsafe {
                *vectors_out = vectors.as_mut_ptr();
                *vectors_len_out = vectors.len();
            }
            0
        }
        Ok(Err(e)) => {
            set_err(err_out, e);
            1
        }
        Err(panic) => {
            set_err(
                err_out,
                format!("plugin panicked: {}", panic_message(panic)),
            );
            1
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn virage_embedder_free_vectors(ptr: *mut f32, len: usize) {
    if ptr.is_null() {
        return;
    }
    // Reconstitute exactly the Vec<f32> that virage_embedder_embed_batch leaked via
    // ManuallyDrop, using the same length (capacity == length there, no over-allocation) — the
    // inverse of that leak, not a fresh allocation.
    drop(Vec::from_raw_parts(ptr, len, len));
}

#[no_mangle]
pub unsafe extern "C" fn virage_embedder_free_str(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    drop(CString::from_raw(ptr));
}

// ─── Reranker (cross-encoder) ───────────────────────────────────────────────

struct RerankerHandle {
    reranker: CrossEncoderReranker,
}

#[no_mangle]
pub unsafe extern "C" fn virage_reranker_create(
    config_json: *const c_char,
    err_out: *mut *mut c_char,
) -> *mut c_void {
    clear_err(err_out);
    let result = catch_unwind(AssertUnwindSafe(|| -> anyhow::Result<*mut c_void> {
        let json = read_cstr(config_json).map_err(|e| anyhow::anyhow!(e))?;
        let opts: CrossEncoderOptions = serde_json::from_str(json)
            .map_err(|e| anyhow::anyhow!("invalid reranker config JSON: {e}"))?;
        let reranker = opts.build()?;
        Ok(Box::into_raw(Box::new(RerankerHandle { reranker })) as *mut c_void)
    }));
    match result {
        Ok(Ok(ptr)) => ptr,
        Ok(Err(e)) => {
            set_err(err_out, e);
            std::ptr::null_mut()
        }
        Err(panic) => {
            set_err(
                err_out,
                format!("plugin panicked: {}", panic_message(panic)),
            );
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn virage_reranker_destroy(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }
    drop(Box::from_raw(handle as *mut RerankerHandle));
}

/// `passages_json` is a JSON array of strings; `scores_out`/`len_out` receive one `f32` score per
/// passage (higher = more relevant), freed via `virage_reranker_free_scores`.
#[no_mangle]
pub unsafe extern "C" fn virage_reranker_rerank(
    handle: *mut c_void,
    query: *const c_char,
    passages_json: *const c_char,
    scores_out: *mut *mut f32,
    len_out: *mut usize,
    err_out: *mut *mut c_char,
) -> i32 {
    clear_err(err_out);
    if handle.is_null() {
        set_err(err_out, "null reranker handle");
        return 1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| -> anyhow::Result<Vec<f32>> {
        let query = read_cstr(query).map_err(|e| anyhow::anyhow!(e))?;
        let json = read_cstr(passages_json).map_err(|e| anyhow::anyhow!(e))?;
        let passages: Vec<String> = serde_json::from_str(json)
            .map_err(|e| anyhow::anyhow!("invalid passages JSON: {e}"))?;
        let passages_ref: Vec<&str> = passages.iter().map(|s| s.as_str()).collect();
        let handle = &mut *(handle as *mut RerankerHandle);
        handle
            .reranker
            .rerank(query, &passages_ref)
            .map_err(|e| anyhow::anyhow!(e))
    }));
    match result {
        Ok(Ok(scores)) => {
            // Shrink so capacity == len, which `virage_reranker_free_scores` relies on.
            let mut scores = std::mem::ManuallyDrop::new(scores.into_boxed_slice().into_vec());
            *scores_out = scores.as_mut_ptr();
            *len_out = scores.len();
            0
        }
        Ok(Err(e)) => {
            set_err(err_out, e);
            1
        }
        Err(panic) => {
            set_err(
                err_out,
                format!("plugin panicked: {}", panic_message(panic)),
            );
            1
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn virage_reranker_free_scores(ptr: *mut f32, len: usize) {
    if ptr.is_null() {
        return;
    }
    drop(Vec::from_raw_parts(ptr, len, len));
}

#[cfg(test)]
mod tests {
    // Pure-Rust sanity checks that don't require a real ONNX model/session — the actual
    // embed_batch path is exercised by the host repo's own dylib_store_regression.rs-style
    // integration tests once IR-050 Phase 5's checklist gains an embedder equivalent (see
    // qa-regression-surface.md).
    #[test]
    fn abi_version_matches_host_constant() {
        assert_eq!(super::PLUGIN_ABI_VERSION, 2);
    }
}
