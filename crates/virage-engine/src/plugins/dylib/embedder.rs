//! `EmbedderVTable` — dylib-plugin ABI for `Embedder` backends.
//!
//! Smaller surface than `StoreVTable`: this crate's `Embedder` trait (`embedders/mod.rs`) is
//! **not** `async` — `embed_batch(&mut self, texts: &[&str]) -> Result<Vec<f32>, String>` is a
//! plain (if potentially slow) synchronous call. No `spawn_blocking`-vs-inline design question at
//! the trait level the way `StoreVTable` has one: there's no `Future` to reconcile. A host still
//! dispatches the FFI call via `tokio::task::spawn_blocking` for the same practical reason as the
//! store side — ONNX inference is not instant and must not run on an async-runtime worker thread
//! — but that's a host-side scheduling choice, not something the ABI itself has to encode
//! differently from a plain blocking call.
//!
//! Same conventions as `StoreVTable` (see that module's docs for the full rationale): plain
//! `#[repr(C)]` + `extern "C"`, `i32` success/error return + `err_out` out-param, plugin-allocated
//! buffers freed via `free_str`, dense vectors cross as raw `(*const f32, usize)`.

use std::ffi::c_char;
use std::ffi::c_void;
use std::path::Path;

use super::PLUGIN_ABI_VERSION;

/// Opaque handle to a plugin-owned embedder instance (holds the loaded ONNX session and
/// tokenizer).
pub type EmbedderHandle = *mut c_void;

/// Raw function pointer table for a dylib `Embedder` plugin.
#[repr(C)]
pub struct EmbedderVTable {
    /// Construct an embedder instance from a JSON-serialized config (model path/id, batch size,
    /// etc). Returns a null handle and populates `err_out` on failure.
    pub create: unsafe extern "C" fn(
        config_json: *const c_char,
        err_out: *mut *mut c_char,
    ) -> EmbedderHandle,

    /// Tear down a handle created by `create`.
    pub destroy: unsafe extern "C" fn(handle: EmbedderHandle),

    /// `Embedder::dimensions`.
    pub dimensions: unsafe extern "C" fn(handle: EmbedderHandle) -> usize,

    /// `Embedder::embed_batch`. `texts_json` is a JSON array of strings (not a raw string-array
    /// ABI — batch sizes here are small enough, and text content itself is already going through
    /// JSON elsewhere in this ABI family, that a second raw-string-array convention isn't worth
    /// adding). Output is packed row-major into a plugin-allocated `*mut f32` buffer of length
    /// `texts.len() * dimensions()`, returned via `vectors_out` + `vectors_len_out`. Freed via
    /// `free_vectors`, not `free_str` — this buffer is `f32`, not a `CStr`.
    pub embed_batch: unsafe extern "C" fn(
        handle: EmbedderHandle,
        texts_json: *const c_char,
        vectors_out: *mut *mut f32,
        vectors_len_out: *mut usize,
        err_out: *mut *mut c_char,
    ) -> i32,

    /// Frees a buffer returned by `embed_batch` via `vectors_out`.
    pub free_vectors: unsafe extern "C" fn(*mut f32, usize),

    /// Frees a `*mut c_char` returned via `err_out`. Same pattern as `ChunkerVTable::free_str`.
    pub free_str: unsafe extern "C" fn(*mut c_char),

    /// Returns the ABI version this plugin was compiled against.
    pub abi_version: unsafe extern "C" fn() -> u32,
}

/// Loaded dylib embedder plugin with its vtable.
pub struct DylibEmbedderPlugin {
    _lib: libloading::Library,
    vtable: EmbedderVTable,
}

impl DylibEmbedderPlugin {
    /// Load an embedder dylib plugin from `path` and verify its ABI version.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let lib = unsafe { libloading::Library::new(path) }
            .map_err(|e| anyhow::anyhow!("Cannot load embedder plugin {:?}: {e}", path))?;

        let vtable = unsafe {
            let abi_fn: libloading::Symbol<unsafe extern "C" fn() -> u32> = lib
                .get(b"virage_plugin_abi_version\0")
                .map_err(|e| anyhow::anyhow!("Missing virage_plugin_abi_version: {e}"))?;
            let version = abi_fn();
            if version != PLUGIN_ABI_VERSION {
                anyhow::bail!(
                    "Embedder plugin ABI version mismatch: expected {PLUGIN_ABI_VERSION}, got {version}"
                );
            }

            macro_rules! sym {
                ($name:literal) => {
                    *lib.get($name)
                        .map_err(|e| anyhow::anyhow!("Missing {}: {e}", stringify!($name)))?
                };
            }

            EmbedderVTable {
                create: sym!(b"virage_embedder_create\0"),
                destroy: sym!(b"virage_embedder_destroy\0"),
                dimensions: sym!(b"virage_embedder_dimensions\0"),
                embed_batch: sym!(b"virage_embedder_embed_batch\0"),
                free_vectors: sym!(b"virage_embedder_free_vectors\0"),
                free_str: sym!(b"virage_embedder_free_str\0"),
                abi_version: sym!(b"virage_plugin_abi_version\0"),
            }
        };

        Ok(Self { _lib: lib, vtable })
    }

    /// Access the raw vtable. `embed_batch` should be dispatched via `tokio::task::spawn_blocking`
    /// by the caller — see the module docs.
    pub fn vtable(&self) -> &EmbedderVTable {
        &self.vtable
    }
}
