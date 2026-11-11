//! `RerankerDylib` — a `Reranker` that delegates to the `virage_reranker_*` exports of a loaded
//! embedder dylib plugin (`virage-plugin-ort`), so a binary built with `embedder-dylib` can rerank
//! without statically linking ort/tokenizers.
//!
//! The exports are an additive extension of the embedder plugin ABI (`PLUGIN_ABI_VERSION` stays
//! `2`): an older plugin simply lacks the symbols and `open` fails with a "Missing
//! virage_reranker_create" error naming the plugin path. Conventions match `embedders::dylib`:
//! `i32` return (`0` = ok), plugin-allocated `err_out` freed via `virage_embedder_free_str`,
//! inputs as a C string plus a JSON array of passages, scores as a plugin-allocated `f32` buffer
//! freed via `virage_reranker_free_scores`.

use std::ffi::{c_char, c_void, CStr, CString};
use std::path::Path;

use super::Reranker;
use crate::plugins::dylib::PLUGIN_ABI_VERSION;

type CreateFn = unsafe extern "C" fn(*const c_char, *mut *mut c_char) -> *mut c_void;
type DestroyFn = unsafe extern "C" fn(*mut c_void);
type RerankFn = unsafe extern "C" fn(
    *mut c_void,
    *const c_char,
    *const c_char,
    *mut *mut f32,
    *mut usize,
    *mut *mut c_char,
) -> i32;
type FreeScoresFn = unsafe extern "C" fn(*mut f32, usize);
type FreeStrFn = unsafe extern "C" fn(*mut c_char);

pub struct RerankerDylib {
    _lib: libloading::Library,
    handle: *mut c_void,
    destroy: DestroyFn,
    rerank: RerankFn,
    free_scores: FreeScoresFn,
    free_str: FreeStrFn,
}

// Safety: same reasoning as `EmbedderDylib` — calls are synchronous, and ORT sessions have no thread
// affinity. Concurrent access is serialised by the caller's `Mutex` (`rerank` takes `&mut self`).
unsafe impl Send for RerankerDylib {}
unsafe impl Sync for RerankerDylib {}

impl RerankerDylib {
    pub fn open(plugin_path: &Path, config_json: &str) -> anyhow::Result<Self> {
        let lib = unsafe { libloading::Library::new(plugin_path) }
            .map_err(|e| anyhow::anyhow!("Cannot load reranker plugin {:?}: {e}", plugin_path))?;
        let (create, destroy, rerank, free_scores, free_str) = unsafe {
            let abi: libloading::Symbol<unsafe extern "C" fn() -> u32> = lib
                .get(b"virage_plugin_abi_version\0")
                .map_err(|e| anyhow::anyhow!("Missing virage_plugin_abi_version: {e}"))?;
            let version = abi();
            if version != PLUGIN_ABI_VERSION {
                anyhow::bail!(
                    "Reranker plugin ABI version mismatch: expected {PLUGIN_ABI_VERSION}, got {version}"
                );
            }
            macro_rules! sym {
                ($name:literal) => {
                    *lib.get($name).map_err(|e| {
                        anyhow::anyhow!(
                            "Missing {} in {:?} (plugin predates reranker support?): {e}",
                            stringify!($name),
                            plugin_path
                        )
                    })?
                };
            }
            let create: CreateFn = sym!(b"virage_reranker_create\0");
            let destroy: DestroyFn = sym!(b"virage_reranker_destroy\0");
            let rerank: RerankFn = sym!(b"virage_reranker_rerank\0");
            let free_scores: FreeScoresFn = sym!(b"virage_reranker_free_scores\0");
            let free_str: FreeStrFn = sym!(b"virage_embedder_free_str\0");
            (create, destroy, rerank, free_scores, free_str)
        };

        let config = CString::new(config_json)
            .map_err(|e| anyhow::anyhow!("config_json contains an interior NUL byte: {e}"))?;
        let mut err_out: *mut c_char = std::ptr::null_mut();
        let handle = unsafe { create(config.as_ptr(), &mut err_out) };
        if handle.is_null() {
            let msg = unsafe { take_err(err_out, free_str) }
                .unwrap_or_else(|| "virage_reranker_create failed with no error message".into());
            anyhow::bail!("failed to create dylib reranker: {msg}");
        }
        Ok(Self {
            _lib: lib,
            handle,
            destroy,
            rerank,
            free_scores,
            free_str,
        })
    }
}

impl Drop for RerankerDylib {
    fn drop(&mut self) {
        unsafe { (self.destroy)(self.handle) };
    }
}

unsafe fn take_err(err_out: *mut c_char, free_str: FreeStrFn) -> Option<String> {
    if err_out.is_null() {
        return None;
    }
    let s = CStr::from_ptr(err_out).to_string_lossy().into_owned();
    free_str(err_out);
    Some(s)
}

impl Reranker for RerankerDylib {
    fn rerank(&mut self, query: &str, passages: &[&str]) -> Result<Vec<f32>, String> {
        if passages.is_empty() {
            return Ok(vec![]);
        }
        let query_c = CString::new(query).map_err(|e| e.to_string())?;
        let passages_c = CString::new(serde_json::to_string(passages).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        unsafe {
            let mut scores_out: *mut f32 = std::ptr::null_mut();
            let mut len_out: usize = 0;
            let mut err_out: *mut c_char = std::ptr::null_mut();
            let rc = (self.rerank)(
                self.handle,
                query_c.as_ptr(),
                passages_c.as_ptr(),
                &mut scores_out,
                &mut len_out,
                &mut err_out,
            );
            if rc != 0 {
                return Err(take_err(err_out, self.free_str)
                    .unwrap_or_else(|| "virage_reranker_rerank failed".to_string()));
            }
            let scores = std::slice::from_raw_parts(scores_out, len_out).to_vec();
            (self.free_scores)(scores_out, len_out);
            Ok(scores)
        }
    }
}
