//! `cdylib` dylib-plugin exporting `LanceDbStore` behind the dylib-plugin
//! host's `StoreVTable` ABI (IR-050 Phase 2).
//!
//! Every export here is the plugin-side half of a contract documented on the
//! host side, in the host repo's `plugins/dylib/store.rs` — read that
//! module's docs first, this file doesn't re-derive the design:
//!
//! - async boundary: this plugin owns one `tokio::runtime::Runtime` per
//!   handle (constructed in `virage_store_create`), and every export blocks
//!   on it via `Handle::block_on`. The host must call these through
//!   `spawn_blocking` — this crate has no way to enforce that, it's a
//!   calling-convention contract on the host side.
//! - data marshaling: dense vectors cross as raw `(*const f32, usize)`;
//!   everything else crosses as a JSON `CStr` buffer (see `wire.rs`).
//! - error convention: `i32` return (`0` = ok), `err_out` populated with a
//!   plugin-allocated, `virage_store_free_str`-owned message on failure.
//! - panic safety: every export is wrapped in `catch_unwind` — an
//!   `extern "C"` fn that unwinds across the FFI boundary aborts the whole
//!   host process rather than being UB, but that's still worse than
//!   reporting a normal error through `err_out`. This is exactly the
//!   "panic-propagation-across-FFI" case IR-050's qa-gates checklist
//!   (`docs/ai/facts/qa-regression-surface.md`) requires covering.
//!
//! `PLUGIN_ABI_VERSION` here must track the host's own ABI-version constant
//! exactly (currently `2`) — this crate has no build or dependency
//! relationship to the closed-source host codebase that loads it, so the
//! value is duplicated by hand rather than shared via a common dependency.
//! Bumping one without the other is caught at load time by the host's
//! version check, not at compile time here.

// Safety contract for every `extern "C"` export below is the one documented
// on `StoreVTable` in the host repo's `plugins/dylib/store.rs` (pointer
// ownership, null handling, exactly-once `destroy`, `spawn_blocking`
// dispatch) — restating it per-function here would just drift from that
// source of truth, so it's centralized in this one `allow` instead of a
// `# Safety` doc section on each fn.
#![allow(clippy::missing_safety_doc)]

mod wire;

use std::ffi::{c_char, c_void, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};

use virage_engine::stores::lancedb::LanceDbStore;
use virage_engine::stores::{IndexMeta, SearchOptions, VectorDocument, VectorStore};

use wire::{
    results_to_json, WireIndexMeta, WireSearchOptions, WireStoreConfig, WireVectorDocument,
};

/// Must match the dylib-plugin host's `PLUGIN_ABI_VERSION` constant.
const PLUGIN_ABI_VERSION: u32 = 2;

/// Plugin-owned state behind an opaque `StoreHandle`.
struct Handle {
    rt: tokio::runtime::Runtime,
    store: LanceDbStore,
}

// ─── Error / string helpers ────────────────────────────────────────────────

/// Write `msg` into `*err_out` as a plugin-owned `CString`. `err_out` is
/// assumed non-null (callers always pass a valid out-param per the ABI
/// contract) — a null `err_out` is a host bug, not something this plugin can
/// recover from, so it's asserted rather than silently ignored.
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

unsafe fn set_out_json(out_json: *mut *mut c_char, s: String) {
    if out_json.is_null() {
        return;
    }
    let c = CString::new(s).unwrap_or_else(|_| CString::new("null").unwrap());
    *out_json = c.into_raw();
}

/// Runs `f`, converting any panic or `Err` into the `err_out` convention.
/// Returns `0` on success, `1` on failure — the uniform return code every
/// export in this file uses.
unsafe fn ffi_call(err_out: *mut *mut c_char, f: impl FnOnce() -> anyhow::Result<()>) -> i32 {
    clear_err(err_out);
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(())) => 0,
        Ok(Err(e)) => {
            set_err(err_out, e);
            1
        }
        Err(panic) => {
            let msg = panic
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "panic in virage-plugin-lancedb (no message)".to_string());
            set_err(err_out, format!("plugin panicked: {msg}"));
            1
        }
    }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

#[no_mangle]
pub unsafe extern "C" fn virage_plugin_abi_version() -> u32 {
    PLUGIN_ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn virage_store_create(
    config_json: *const c_char,
    err_out: *mut *mut c_char,
) -> *mut c_void {
    clear_err(err_out);
    let result = catch_unwind(AssertUnwindSafe(|| -> anyhow::Result<*mut c_void> {
        let json = read_cstr(config_json).map_err(|e| anyhow::anyhow!(e))?;
        let cfg: WireStoreConfig = serde_json::from_str(json)
            .map_err(|e| anyhow::anyhow!("invalid store config JSON: {e}"))?;
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|e| anyhow::anyhow!("failed to start plugin Tokio runtime: {e}"))?;
        let store = LanceDbStore::new(cfg.uri, cfg.table_name, cfg.dimensions);
        let handle = Box::new(Handle { rt, store });
        Ok(Box::into_raw(handle) as *mut c_void)
    }));
    match result {
        Ok(Ok(ptr)) => ptr,
        Ok(Err(e)) => {
            set_err(err_out, e);
            std::ptr::null_mut()
        }
        Err(panic) => {
            let msg = panic
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "panic in virage_store_create".to_string());
            set_err(err_out, format!("plugin panicked: {msg}"));
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn virage_store_destroy(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        drop(Box::from_raw(handle as *mut Handle));
    }));
}

/// Recover a `&Handle` from the opaque pointer. Callers must only pass
/// pointers returned by `virage_store_create` and not yet destroyed.
unsafe fn as_handle<'a>(handle: *mut c_void) -> Result<&'a Handle, String> {
    (handle as *mut Handle)
        .as_ref()
        .ok_or_else(|| "null store handle".to_string())
}

// ─── Operations ─────────────────────────────────────────────────────────────

#[no_mangle]
pub unsafe extern "C" fn virage_store_initialize(
    handle: *mut c_void,
    err_out: *mut *mut c_char,
) -> i32 {
    ffi_call(err_out, || {
        let h = as_handle(handle).map_err(|e| anyhow::anyhow!(e))?;
        h.rt.block_on(h.store.initialize())
    })
}

#[no_mangle]
pub unsafe extern "C" fn virage_store_upsert(
    handle: *mut c_void,
    docs_json: *const c_char,
    vectors_ptr: *const f32,
    vectors_len: usize,
    n_docs: usize,
    err_out: *mut *mut c_char,
) -> i32 {
    ffi_call(err_out, || {
        let h = as_handle(handle).map_err(|e| anyhow::anyhow!(e))?;
        let json = read_cstr(docs_json).map_err(|e| anyhow::anyhow!(e))?;
        let wire_docs: Vec<WireVectorDocument> =
            serde_json::from_str(json).map_err(|e| anyhow::anyhow!("invalid docs_json: {e}"))?;
        if wire_docs.len() != n_docs {
            anyhow::bail!(
                "docs_json has {} entries but n_docs = {n_docs}",
                wire_docs.len()
            );
        }
        let vectors: &[f32] = if vectors_ptr.is_null() {
            if vectors_len != 0 {
                anyhow::bail!("vectors_ptr is null but vectors_len = {vectors_len}");
            }
            &[]
        } else {
            std::slice::from_raw_parts(vectors_ptr, vectors_len)
        };
        let dims = match n_docs {
            0 => 0,
            n => vectors_len
                .checked_div(n)
                .filter(|d| d * n == vectors_len)
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "vectors_len ({vectors_len}) is not evenly divisible by n_docs ({n_docs})"
                    )
                })?,
        };
        let docs: Vec<VectorDocument> = wire_docs
            .into_iter()
            .enumerate()
            .map(|(i, w)| w.into_document(vectors[i * dims..(i + 1) * dims].to_vec()))
            .collect();
        h.rt.block_on(h.store.upsert(&docs))
    })
}

#[no_mangle]
pub unsafe extern "C" fn virage_store_delete_by_source(
    handle: *mut c_void,
    files_json: *const c_char,
    err_out: *mut *mut c_char,
) -> i32 {
    ffi_call(err_out, || {
        let h = as_handle(handle).map_err(|e| anyhow::anyhow!(e))?;
        let json = read_cstr(files_json).map_err(|e| anyhow::anyhow!(e))?;
        let files: Vec<String> =
            serde_json::from_str(json).map_err(|e| anyhow::anyhow!("invalid files_json: {e}"))?;
        let refs: Vec<&str> = files.iter().map(String::as_str).collect();
        h.rt.block_on(h.store.delete_by_source(&refs))
    })
}

#[no_mangle]
pub unsafe extern "C" fn virage_store_existing_hashes(
    handle: *mut c_void,
    hashes_json: *const c_char,
    out_json: *mut *mut c_char,
    err_out: *mut *mut c_char,
) -> i32 {
    ffi_call(err_out, || {
        let h = as_handle(handle).map_err(|e| anyhow::anyhow!(e))?;
        let json = read_cstr(hashes_json).map_err(|e| anyhow::anyhow!(e))?;
        let hashes: Vec<String> =
            serde_json::from_str(json).map_err(|e| anyhow::anyhow!("invalid hashes_json: {e}"))?;
        let refs: Vec<&str> = hashes.iter().map(String::as_str).collect();
        let existing = h.rt.block_on(h.store.existing_hashes(&refs))?;
        let existing: Vec<&String> = existing.iter().collect();
        let out = serde_json::to_string(&existing)?;
        set_out_json(out_json, out);
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn virage_store_current_state(
    handle: *mut c_void,
    out_json: *mut *mut c_char,
    err_out: *mut *mut c_char,
) -> i32 {
    ffi_call(err_out, || {
        let h = as_handle(handle).map_err(|e| anyhow::anyhow!(e))?;
        let state = h.rt.block_on(h.store.current_state())?;
        let out = serde_json::to_string(&state)?;
        set_out_json(out_json, out);
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn virage_store_search(
    handle: *mut c_void,
    query_ptr: *const f32,
    query_len: usize,
    top_k: usize,
    opts_json: *const c_char,
    out_json: *mut *mut c_char,
    err_out: *mut *mut c_char,
) -> i32 {
    ffi_call(err_out, || {
        let h = as_handle(handle).map_err(|e| anyhow::anyhow!(e))?;
        let query: &[f32] = if query_ptr.is_null() {
            if query_len != 0 {
                anyhow::bail!("query_ptr is null but query_len = {query_len}");
            }
            &[]
        } else {
            std::slice::from_raw_parts(query_ptr, query_len)
        };
        let opts: SearchOptions = if opts_json.is_null() {
            SearchOptions::default()
        } else {
            let json = read_cstr(opts_json).map_err(|e| anyhow::anyhow!(e))?;
            let wire: WireSearchOptions = serde_json::from_str(json)
                .map_err(|e| anyhow::anyhow!("invalid opts_json: {e}"))?;
            wire.into()
        };
        let results = h.rt.block_on(h.store.search(query, top_k, opts))?;
        let out = results_to_json(&results)?;
        set_out_json(out_json, out);
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn virage_store_list_all(
    handle: *mut c_void,
    out_json: *mut *mut c_char,
    supported_out: *mut i32,
    err_out: *mut *mut c_char,
) -> i32 {
    ffi_call(err_out, || {
        let h = as_handle(handle).map_err(|e| anyhow::anyhow!(e))?;
        match h.rt.block_on(h.store.list_all())? {
            Some(results) => {
                let out = results_to_json(&results)?;
                set_out_json(out_json, out);
                if !supported_out.is_null() {
                    *supported_out = 1;
                }
            }
            None => {
                if !supported_out.is_null() {
                    *supported_out = 0;
                }
            }
        }
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn virage_store_read_meta(
    handle: *mut c_void,
    out_json: *mut *mut c_char,
    present_out: *mut i32,
    err_out: *mut *mut c_char,
) -> i32 {
    ffi_call(err_out, || {
        let h = as_handle(handle).map_err(|e| anyhow::anyhow!(e))?;
        match h.rt.block_on(h.store.read_meta())? {
            Some(meta) => {
                let wire: WireIndexMeta = (&meta).into();
                let out = serde_json::to_string(&wire)?;
                set_out_json(out_json, out);
                if !present_out.is_null() {
                    *present_out = 1;
                }
            }
            None => {
                if !present_out.is_null() {
                    *present_out = 0;
                }
            }
        }
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn virage_store_write_meta(
    handle: *mut c_void,
    meta_json: *const c_char,
    err_out: *mut *mut c_char,
) -> i32 {
    ffi_call(err_out, || {
        let h = as_handle(handle).map_err(|e| anyhow::anyhow!(e))?;
        let json = read_cstr(meta_json).map_err(|e| anyhow::anyhow!(e))?;
        let wire: WireIndexMeta =
            serde_json::from_str(json).map_err(|e| anyhow::anyhow!("invalid meta_json: {e}"))?;
        let meta: IndexMeta = wire.into();
        h.rt.block_on(h.store.write_meta(&meta))
    })
}

#[no_mangle]
pub unsafe extern "C" fn virage_store_free_str(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        drop(CString::from_raw(ptr));
    }));
}

#[cfg(test)]
mod tests {
    use super::wire::*;

    #[test]
    fn abi_version_is_two() {
        assert_eq!(super::PLUGIN_ABI_VERSION, 2);
    }

    #[test]
    fn wire_search_options_round_trips_defaults() {
        let json = "{}";
        let w: WireSearchOptions = serde_json::from_str(json).unwrap();
        assert!(!w.hybrid);
        assert!((w.hybrid_alpha - 0.6).abs() < f32::EPSILON);
    }

    #[test]
    fn wire_vector_document_reattaches_dense_vector() {
        let json = r#"{
            "id": "abc",
            "dense_text": "hello",
            "sparse_text": "hello",
            "dense_text_hash": "abc",
            "sparse_text_generator_id": "g1",
            "metadata_generator_id": "g1",
            "source_file": "f.md",
            "commit_hash": "h1"
        }"#;
        let w: WireVectorDocument = serde_json::from_str(json).unwrap();
        let doc = w.into_document(vec![1.0, 2.0, 3.0]);
        assert_eq!(doc.dense_vector, vec![1.0, 2.0, 3.0]);
        assert_eq!(doc.id, "abc");
    }
}
