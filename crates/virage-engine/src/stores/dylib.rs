//! `DylibStore` — a `VectorStore` implementation that delegates every operation through a loaded
//! `StoreVTable` dylib plugin (`plugins::dylib::store`) instead of linking a backend's dependency
//! graph directly into this binary. Local-dev/CI-iteration alternative to `store-lancedb`'s
//! statically-linked `LanceDbStore` — same trait, backend-agnostic (works against any plugin that
//! implements the `StoreVTable` ABI, not just a lancedb one), different link/compile cost.
//!
//! ## Verification status
//!
//! Compiles and type-checks cleanly (Q0/Q1); wire-format conversions have unit test coverage.
//! **Not yet exercised against a real loaded plugin `.so`** — no live `index`/`search` round-trip
//! has been run through this path. The regression-surface checklist this needs before it's safe
//! to treat as production-ready (panic containment, concurrent-access correctness, ABI-mismatch
//! rejection, index/query round-trip parity) is tracked, not yet automated — see
//! `qa-regression-surface.md`'s "CE dylib-plugin dev-loop boundary" entry. Do not remove that
//! caveat by editing this comment; remove it only once those checks actually exist and pass.
//!
//! ## Concurrency
//!
//! `DylibStore` is `unsafe impl Send + Sync` — a raw `StoreHandle` (`*mut c_void`) isn't Send/Sync
//! by default. Soundness of that impl rests on an assumption this module does not itself prove:
//! that the plugin's own exported functions synchronize correctly when called concurrently
//! through the same handle from multiple OS threads (the plugin owns its Tokio runtime and its
//! backend's interior state uses its own locking — e.g. `LanceDbStore`'s
//! `tokio::sync::RwLock<Option<LanceState>>`). This is exactly the "concurrent-access correctness"
//! item the regression-surface checklist above requires proving, not assuming.
//!
//! ## Plugin discoverability
//!
//! The plugin `.so`/`.dylib`/`.dll` path is not guessed from a relative `target/` layout (fragile
//! across platforms, profiles, and out-of-tree builds) — `DylibStore::open` takes it as an
//! explicit `&Path` argument. Callers (CLI config resolution, once wired) are expected to source
//! it from an env var or config field; this module does not prescribe which.

use std::collections::{HashMap, HashSet};
use std::ffi::{c_void, CStr, CString};
use std::path::Path;

use async_trait::async_trait;

use super::{IndexMeta, SearchOptions, SearchResult, VectorDocument, VectorStore};
use crate::plugins::dylib::store::{DylibStorePlugin, StoreHandle, StoreVTable};

mod wire;
use wire::{WireIndexMeta, WireSearchOptions};

/// A `VectorStore` backed by a loaded dylib plugin instance.
pub struct DylibStore {
    plugin: DylibStorePlugin,
    handle: StoreHandle,
}

// Safety: see the module-level "Concurrency" doc section — this asserts, doesn't prove, that the
// plugin's exported functions synchronize correctly under concurrent access to one handle.
unsafe impl Send for DylibStore {}
unsafe impl Sync for DylibStore {}

impl DylibStore {
    /// Load `plugin_path` and construct a store instance from a JSON-serialized backend config
    /// (shape is plugin-specific — for `virage-plugin-lancedb`, `{"uri", "table_name",
    /// "dimensions"}`).
    pub fn open(plugin_path: &Path, config_json: &str) -> anyhow::Result<Self> {
        let plugin = DylibStorePlugin::load(plugin_path)?;
        let config = CString::new(config_json)
            .map_err(|e| anyhow::anyhow!("config_json contains an interior NUL byte: {e}"))?;
        let mut err_out: *mut std::ffi::c_char = std::ptr::null_mut();
        let handle = unsafe { (plugin.vtable().create)(config.as_ptr(), &mut err_out) };
        if handle.is_null() {
            let msg = unsafe { take_err(err_out, plugin.vtable()) }
                .unwrap_or_else(|| "virage_store_create failed with no error message".to_string());
            anyhow::bail!("failed to create dylib store: {msg}");
        }
        Ok(Self { plugin, handle })
    }
}

impl Drop for DylibStore {
    fn drop(&mut self) {
        let destroy = self.plugin.vtable().destroy;
        let handle = self.handle;
        unsafe { destroy(handle) };
    }
}

/// Reads and frees an `err_out` buffer, if non-null.
unsafe fn take_err(err_out: *mut std::ffi::c_char, vtable: &StoreVTable) -> Option<String> {
    if err_out.is_null() {
        return None;
    }
    let s = CStr::from_ptr(err_out).to_string_lossy().into_owned();
    (vtable.free_str)(err_out);
    Some(s)
}

/// Reads and frees an `out_json` buffer, if non-null.
unsafe fn take_out(out_json: *mut std::ffi::c_char, vtable: &StoreVTable) -> Option<String> {
    if out_json.is_null() {
        return None;
    }
    let s = CStr::from_ptr(out_json).to_string_lossy().into_owned();
    (vtable.free_str)(out_json);
    Some(s)
}

/// Runs a plugin call on the blocking thread pool, per `StoreVTable`'s calling-convention
/// contract (see `plugins::dylib::store`'s module docs). Takes the handle as a `usize` address,
/// not a `StoreHandle` (`*mut c_void`) — `#[async_trait]` requires every trait method's returned
/// `Future` to be `Send`, and a raw pointer held anywhere in that `Future`'s captured state
/// (including transitively, through a nested `.await` on this fn) makes the whole chain `!Send`
/// even though `DylibStore` itself is `unsafe impl Send`. Callers must cast `self.handle as usize`
/// at the call site, before it can be captured by any `async fn`'s generated state machine.
/// `StoreVTable` itself doesn't need this — it holds only function pointers, `Send`/`Sync`/`Copy`
/// unconditionally, carrying no interior data.
async fn call_blocking<T: Send + 'static>(
    handle_addr: usize,
    vtable: StoreVTable,
    f: impl FnOnce(StoreHandle, &StoreVTable) -> anyhow::Result<T> + Send + 'static,
) -> anyhow::Result<T> {
    tokio::task::spawn_blocking(move || {
        let handle = handle_addr as *mut c_void;
        f(handle, &vtable)
    })
    .await
    .map_err(|e| anyhow::anyhow!("dylib store call panicked or was cancelled: {e}"))?
}

#[async_trait]
impl VectorStore for DylibStore {
    async fn initialize(&self) -> anyhow::Result<()> {
        let vtable = *self.plugin.vtable();
        call_blocking(self.handle as usize, vtable, |handle, vtable| unsafe {
            let mut err_out = std::ptr::null_mut();
            let rc = (vtable.initialize)(handle, &mut err_out);
            if rc != 0 {
                let msg = take_err(err_out, vtable)
                    .unwrap_or_else(|| "virage_store_initialize failed".to_string());
                anyhow::bail!(msg);
            }
            Ok(())
        })
        .await
    }

    async fn upsert(&self, docs: &[VectorDocument]) -> anyhow::Result<()> {
        let docs_json = wire::docs_to_json(docs)?;
        let n_docs = docs.len();
        let vectors: Vec<f32> = docs
            .iter()
            .flat_map(|d| d.dense_vector.iter().copied())
            .collect();
        let vtable = *self.plugin.vtable();
        call_blocking(self.handle as usize, vtable, move |handle, vtable| unsafe {
            let docs_c = CString::new(docs_json)?;
            let mut err_out = std::ptr::null_mut();
            let rc = (vtable.upsert)(
                handle,
                docs_c.as_ptr(),
                vectors.as_ptr(),
                vectors.len(),
                n_docs,
                &mut err_out,
            );
            if rc != 0 {
                let msg = take_err(err_out, vtable)
                    .unwrap_or_else(|| "virage_store_upsert failed".to_string());
                anyhow::bail!(msg);
            }
            Ok(())
        })
        .await
    }

    async fn delete_by_source(&self, files: &[&str]) -> anyhow::Result<()> {
        let files_json = serde_json::to_string(files)?;
        let vtable = *self.plugin.vtable();
        call_blocking(self.handle as usize, vtable, move |handle, vtable| unsafe {
            let files_c = CString::new(files_json)?;
            let mut err_out = std::ptr::null_mut();
            let rc = (vtable.delete_by_source)(handle, files_c.as_ptr(), &mut err_out);
            if rc != 0 {
                let msg = take_err(err_out, vtable)
                    .unwrap_or_else(|| "virage_store_delete_by_source failed".to_string());
                anyhow::bail!(msg);
            }
            Ok(())
        })
        .await
    }

    async fn existing_hashes(&self, hashes: &[&str]) -> anyhow::Result<HashSet<String>> {
        let hashes_json = serde_json::to_string(hashes)?;
        let vtable = *self.plugin.vtable();
        call_blocking(self.handle as usize, vtable, move |handle, vtable| unsafe {
            let hashes_c = CString::new(hashes_json)?;
            let mut out_json = std::ptr::null_mut();
            let mut err_out = std::ptr::null_mut();
            let rc =
                (vtable.existing_hashes)(handle, hashes_c.as_ptr(), &mut out_json, &mut err_out);
            if rc != 0 {
                let msg = take_err(err_out, vtable)
                    .unwrap_or_else(|| "virage_store_existing_hashes failed".to_string());
                anyhow::bail!(msg);
            }
            let out = take_out(out_json, vtable).unwrap_or_else(|| "[]".to_string());
            let hashes: Vec<String> = serde_json::from_str(&out)?;
            Ok(hashes.into_iter().collect())
        })
        .await
    }

    async fn current_state(&self) -> anyhow::Result<HashMap<String, String>> {
        let vtable = *self.plugin.vtable();
        call_blocking(self.handle as usize, vtable, |handle, vtable| unsafe {
            let mut out_json = std::ptr::null_mut();
            let mut err_out = std::ptr::null_mut();
            let rc = (vtable.current_state)(handle, &mut out_json, &mut err_out);
            if rc != 0 {
                let msg = take_err(err_out, vtable)
                    .unwrap_or_else(|| "virage_store_current_state failed".to_string());
                anyhow::bail!(msg);
            }
            let out = take_out(out_json, vtable).unwrap_or_else(|| "{}".to_string());
            Ok(serde_json::from_str(&out)?)
        })
        .await
    }

    async fn search(
        &self,
        query: &[f32],
        top_k: usize,
        opts: SearchOptions,
    ) -> anyhow::Result<Vec<SearchResult>> {
        let opts_json = serde_json::to_string(&WireSearchOptions::from(&opts))?;
        let query = query.to_vec();
        let vtable = *self.plugin.vtable();
        call_blocking(self.handle as usize, vtable, move |handle, vtable| unsafe {
            let opts_c = CString::new(opts_json)?;
            let mut out_json = std::ptr::null_mut();
            let mut err_out = std::ptr::null_mut();
            let rc = (vtable.search)(
                handle,
                query.as_ptr(),
                query.len(),
                top_k,
                opts_c.as_ptr(),
                &mut out_json,
                &mut err_out,
            );
            if rc != 0 {
                let msg = take_err(err_out, vtable)
                    .unwrap_or_else(|| "virage_store_search failed".to_string());
                anyhow::bail!(msg);
            }
            let out = take_out(out_json, vtable).unwrap_or_else(|| "[]".to_string());
            wire::results_from_json(&out)
        })
        .await
    }

    async fn list_all(&self) -> anyhow::Result<Option<Vec<SearchResult>>> {
        let vtable = *self.plugin.vtable();
        call_blocking(self.handle as usize, vtable, |handle, vtable| unsafe {
            let mut out_json = std::ptr::null_mut();
            let mut supported_out: i32 = 0;
            let mut err_out = std::ptr::null_mut();
            let rc = (vtable.list_all)(handle, &mut out_json, &mut supported_out, &mut err_out);
            if rc != 0 {
                let msg = take_err(err_out, vtable)
                    .unwrap_or_else(|| "virage_store_list_all failed".to_string());
                anyhow::bail!(msg);
            }
            if supported_out == 0 {
                return Ok(None);
            }
            let out = take_out(out_json, vtable).unwrap_or_else(|| "[]".to_string());
            Ok(Some(wire::results_from_json(&out)?))
        })
        .await
    }

    async fn read_meta(&self) -> anyhow::Result<Option<IndexMeta>> {
        let vtable = *self.plugin.vtable();
        call_blocking(self.handle as usize, vtable, |handle, vtable| unsafe {
            let mut out_json = std::ptr::null_mut();
            let mut present_out: i32 = 0;
            let mut err_out = std::ptr::null_mut();
            let rc = (vtable.read_meta)(handle, &mut out_json, &mut present_out, &mut err_out);
            if rc != 0 {
                let msg = take_err(err_out, vtable)
                    .unwrap_or_else(|| "virage_store_read_meta failed".to_string());
                anyhow::bail!(msg);
            }
            if present_out == 0 {
                return Ok(None);
            }
            let out = take_out(out_json, vtable).unwrap_or_else(|| "null".to_string());
            let wire: WireIndexMeta = serde_json::from_str(&out)?;
            Ok(Some(wire.into()))
        })
        .await
    }

    async fn write_meta(&self, meta: &IndexMeta) -> anyhow::Result<()> {
        let meta_json = serde_json::to_string(&WireIndexMeta::from(meta))?;
        let vtable = *self.plugin.vtable();
        call_blocking(self.handle as usize, vtable, move |handle, vtable| unsafe {
            let meta_c = CString::new(meta_json)?;
            let mut err_out = std::ptr::null_mut();
            let rc = (vtable.write_meta)(handle, meta_c.as_ptr(), &mut err_out);
            if rc != 0 {
                let msg = take_err(err_out, vtable)
                    .unwrap_or_else(|| "virage_store_write_meta failed".to_string());
                anyhow::bail!(msg);
            }
            Ok(())
        })
        .await
    }
}
