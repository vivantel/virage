//! `EmbedderDylib` — an `Embedder` implementation that delegates through a loaded `EmbedderVTable`
//! dylib plugin instead of linking a backend's dependency graph directly into this binary.
//! Mirrors `stores::dylib::DylibStore` (IR-051's CE dev-loop pattern, IR-050's Phase 3/4
//! host-wiring for any consumer of this ABI); see that module's docs for the fuller architecture
//! rationale.
//!
//! Unlike `DylibStore`, `Embedder::embed_batch` is a plain synchronous fn (`&mut self`, no
//! `async_trait`) — there's no `Future` to keep `Send` across an `.await`, so no
//! `spawn_blocking`/handle-as-usize indirection is needed here (`plugins::dylib::embedder`'s own
//! module docs explain why the ABI doesn't need one either): the FFI call happens inline, still on
//! whatever thread the caller is already on. Callers embedding on a hot path may want to wrap this
//! in their own `spawn_blocking` — this type doesn't do it for them, matching the plain
//! `OnnxEmbedder` it stands in for, which also blocks its caller's thread during inference.

use std::ffi::{c_char, CStr, CString};
use std::path::Path;

use super::Embedder;
use crate::plugins::dylib::embedder::{DylibEmbedderPlugin, EmbedderHandle, EmbedderVTable};

/// An `Embedder` backed by a loaded dylib plugin instance.
pub struct EmbedderDylib {
    plugin: DylibEmbedderPlugin,
    handle: EmbedderHandle,
    dimensions: usize,
}

// Safety: `EmbedderHandle` (`*mut c_void`) isn't Send/Sync by default. This module's own calls are
// all synchronous and single-threaded per call (no concurrent-access design question the way
// `DylibStore` has one — nothing here hands the handle to another thread mid-call), so the only
// real assumption is that the plugin's own `create`/`embed_batch`/`destroy` don't themselves rely
// on thread-affinity. `OnnxInferenceSession` (what `virage-plugin-ort` wraps) has no such
// affinity — ORT sessions are documented safe to call from any thread.
unsafe impl Send for EmbedderDylib {}
unsafe impl Sync for EmbedderDylib {}

impl EmbedderDylib {
    /// Load `plugin_path` and construct an embedder instance from a JSON-serialized config (shape
    /// is plugin-specific — for `virage-plugin-ort`, the same fields
    /// `config::resolve::OnnxEmbedderOptions` parses for the statically-linked path).
    pub fn open(plugin_path: &Path, config_json: &str) -> anyhow::Result<Self> {
        let plugin = DylibEmbedderPlugin::load(plugin_path)?;
        let config = CString::new(config_json)
            .map_err(|e| anyhow::anyhow!("config_json contains an interior NUL byte: {e}"))?;
        let mut err_out: *mut c_char = std::ptr::null_mut();
        let handle = unsafe { (plugin.vtable().create)(config.as_ptr(), &mut err_out) };
        if handle.is_null() {
            let msg = unsafe { take_err(err_out, plugin.vtable()) }.unwrap_or_else(|| {
                "virage_embedder_create failed with no error message".to_string()
            });
            anyhow::bail!("failed to create dylib embedder: {msg}");
        }
        let dimensions = unsafe { (plugin.vtable().dimensions)(handle) };
        Ok(Self {
            plugin,
            handle,
            dimensions,
        })
    }
}

impl Drop for EmbedderDylib {
    fn drop(&mut self) {
        let destroy = self.plugin.vtable().destroy;
        let handle = self.handle;
        unsafe { destroy(handle) };
    }
}

/// Reads and frees an `err_out` buffer, if non-null. Same pattern as `stores::dylib`'s helper.
unsafe fn take_err(err_out: *mut c_char, vtable: &EmbedderVTable) -> Option<String> {
    if err_out.is_null() {
        return None;
    }
    let s = CStr::from_ptr(err_out).to_string_lossy().into_owned();
    (vtable.free_str)(err_out);
    Some(s)
}

impl Embedder for EmbedderDylib {
    fn dimensions(&self) -> usize {
        self.dimensions
    }

    fn embed_batch(&mut self, texts: &[&str]) -> Result<Vec<f32>, String> {
        if texts.is_empty() {
            return Ok(vec![]);
        }
        let texts_json = serde_json::to_string(texts).map_err(|e| e.to_string())?;
        let texts_c = CString::new(texts_json).map_err(|e| e.to_string())?;
        let vtable = self.plugin.vtable();
        unsafe {
            let mut vectors_out: *mut f32 = std::ptr::null_mut();
            let mut vectors_len_out: usize = 0;
            let mut err_out: *mut c_char = std::ptr::null_mut();
            let rc = (vtable.embed_batch)(
                self.handle,
                texts_c.as_ptr(),
                &mut vectors_out,
                &mut vectors_len_out,
                &mut err_out,
            );
            if rc != 0 {
                let msg = take_err(err_out, vtable)
                    .unwrap_or_else(|| "virage_embedder_embed_batch failed".to_string());
                return Err(msg);
            }
            let vectors = std::slice::from_raw_parts(vectors_out, vectors_len_out).to_vec();
            (vtable.free_vectors)(vectors_out, vectors_len_out);
            Ok(vectors)
        }
    }
}
