//! `StoreVTable` — dylib-plugin ABI for `VectorStore` backends.
//!
//! Mirrors `dylib/mod.rs`'s `ChunkerVTable`: plain `#[repr(C)]` + `extern "C"` fn pointers, no
//! `abi_stable`. See `docs/ai/facts/dylib-plugin-abi.md` (in the repo that consumes this crate as
//! a documentation dependency) for the full design rationale.
//!
//! ## Async boundary
//!
//! This crate's `VectorStore` trait (`stores/mod.rs`) is `#[async_trait]` — no C ABI for
//! `Future`. Per design: the plugin owns its own Tokio runtime (constructed once, in
//! `virage_store_create`) and every `extern "C"` fn blocks internally via `Handle::block_on`. Any
//! host loading this vtable must call every function on it through `tokio::task::spawn_blocking`
//! — never directly on an async-context thread — so the host's own runtime isn't starved. This is
//! a hard calling contract, not an implementation detail: violating it (calling these fns inline
//! from an async fn) will deadlock or starve the host runtime under concurrent load.
//!
//! ## Data marshaling
//!
//! - Dense vectors (`Vec<f32>`) cross as raw `(*const f32, usize)` pairs — zero-copy, host retains
//!   ownership, plugin must not free them.
//! - Everything else with nested/dynamic shape (`VectorDocument` sans its vector, `SearchOptions`,
//!   `SearchResult`, `HashMap<String, Value>` metadata/filters, `IndexMeta`) crosses as a single
//!   JSON-serialized `CStr` buffer. This applies uniformly, including to `list_all` — see the
//!   `list_all` note below for why this isn't special-cased.
//! - Ownership follows `ChunkerVTable::free_str`'s existing pattern: any `*mut c_char` a plugin
//!   function *returns* (via an `*mut *mut c_char` out-param) was allocated by the plugin and must
//!   be released by the host calling `free_str` — never `free()`'d directly, since the plugin's
//!   allocator may differ from the host's. Buffers the host *passes in* (`*const c_char` request
//!   payloads) are owned and freed by the host; the plugin must not free them.
//!
//! ## Error convention
//!
//! Every fallible operation returns `i32` (`0` = success, nonzero = error) and writes a
//! plugin-allocated, `free_str`-owned error message through an `err_out: *mut *mut c_char`
//! out-param on failure (left null on success). This mirrors `anyhow::Result<T>` without needing
//! an ABI-stable `Result` representation.
//!
//! ## `list_all`
//!
//! `VectorStore::list_all` returns `anyhow::Result<Option<Vec<SearchResult>>>` — the most
//! FFI-hostile method in the trait (unbounded-size return). Resolved here as a **real export, not
//! a host-side "unsupported" special case**: it uses the exact same JSON-over-CStr buffer
//! mechanism as `search`'s results, just with no `top_k` bound. Reasons this doesn't need
//! different treatment:
//! - The call is already rare and expensive in-process (`virage quality run`, a full index scan) —
//!   the FFI hop adds serialization overhead but not a new order of magnitude for an
//!   infrequent, not-hot-path call.
//! - `Option`-ness (whether a backend supports a full scan at all) is carried the same way
//!   `read_meta` already carries its `Option<IndexMeta>` — a `supported_out: *mut i32` flag, not a
//!   second special API shape.
//! - A two-tier API (some methods real exports, one method a host-side stub) would be more surface
//!   area to maintain than one consistent JSON-buffer-return convention applied everywhere, for a
//!   method that isn't actually called differently at the trait level.

use std::ffi::c_char;
use std::ffi::c_void;
use std::path::Path;

use super::PLUGIN_ABI_VERSION;

/// Opaque handle to a plugin-owned store instance. The host never dereferences this — it's passed
/// back on every call so the plugin can recover its state (including its owned Tokio runtime).
pub type StoreHandle = *mut c_void;

/// Raw function pointer table for a dylib `VectorStore` plugin. `Clone`/`Copy`: every field is a
/// plain fn pointer (no interior data), so a bitwise copy is exactly correct — lets host callers
/// (e.g. `stores::dylib::DylibStore`) move an owned copy into a `spawn_blocking` closure instead
/// of holding a borrow across the `.await`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct StoreVTable {
    /// Construct a store instance from a JSON-serialized backend config (`config_json`, e.g.
    /// LanceDB URI, table name, credentials). Returns a null handle and populates `err_out` on
    /// failure. The plugin creates its own Tokio runtime here — one runtime per handle, not per
    /// call.
    pub create:
        unsafe extern "C" fn(config_json: *const c_char, err_out: *mut *mut c_char) -> StoreHandle,

    /// Tear down a handle created by `create`, including its Tokio runtime. Must be called
    /// exactly once per successful `create`.
    pub destroy: unsafe extern "C" fn(handle: StoreHandle),

    /// `VectorStore::initialize` — schema/index/connection setup.
    pub initialize: unsafe extern "C" fn(handle: StoreHandle, err_out: *mut *mut c_char) -> i32,

    /// `VectorStore::upsert`. `docs_json` is a JSON array of `VectorDocument` with `dense_vector`
    /// omitted (carried out-of-band below); dense vectors for all docs are packed row-major into
    /// `vectors_ptr` (`vectors_len` = `n_docs * dims`, dims inferred as `vectors_len / n_docs` —
    /// every doc in one call shares the embedder's dimensionality).
    pub upsert: unsafe extern "C" fn(
        handle: StoreHandle,
        docs_json: *const c_char,
        vectors_ptr: *const f32,
        vectors_len: usize,
        n_docs: usize,
        err_out: *mut *mut c_char,
    ) -> i32,

    /// `VectorStore::delete_by_source`. `files_json`: JSON array of strings.
    pub delete_by_source: unsafe extern "C" fn(
        handle: StoreHandle,
        files_json: *const c_char,
        err_out: *mut *mut c_char,
    ) -> i32,

    /// `VectorStore::existing_hashes`. `hashes_json` in, JSON array of strings out via `out_json`
    /// (plugin-allocated, `free_str`-owned).
    pub existing_hashes: unsafe extern "C" fn(
        handle: StoreHandle,
        hashes_json: *const c_char,
        out_json: *mut *mut c_char,
        err_out: *mut *mut c_char,
    ) -> i32,

    /// `VectorStore::current_state`. `out_json`: JSON object, `source_file -> commit_hash`.
    pub current_state: unsafe extern "C" fn(
        handle: StoreHandle,
        out_json: *mut *mut c_char,
        err_out: *mut *mut c_char,
    ) -> i32,

    /// `VectorStore::search`. `query_ptr`/`query_len` is the raw query vector; `opts_json` is a
    /// JSON-serialized `SearchOptions`; `out_json` receives a JSON array of `SearchResult`.
    pub search: unsafe extern "C" fn(
        handle: StoreHandle,
        query_ptr: *const f32,
        query_len: usize,
        top_k: usize,
        opts_json: *const c_char,
        out_json: *mut *mut c_char,
        err_out: *mut *mut c_char,
    ) -> i32,

    /// `VectorStore::list_all`. See the module-level `list_all` note — real export, same
    /// JSON-buffer convention as `search`, no size special-case. `supported_out` is written
    /// `0`/`1` to carry the `Option`-ness (`0` = this backend doesn't support a full scan,
    /// `out_json` left null); `1` = supported, `out_json` holds the JSON array of `SearchResult`.
    pub list_all: unsafe extern "C" fn(
        handle: StoreHandle,
        out_json: *mut *mut c_char,
        supported_out: *mut i32,
        err_out: *mut *mut c_char,
    ) -> i32,

    /// `VectorStore::read_meta`. `present_out`: `0`/`1`, same `Option` convention as `list_all`'s
    /// `supported_out`.
    pub read_meta: unsafe extern "C" fn(
        handle: StoreHandle,
        out_json: *mut *mut c_char,
        present_out: *mut i32,
        err_out: *mut *mut c_char,
    ) -> i32,

    /// `VectorStore::write_meta`. `meta_json`: JSON-serialized `IndexMeta`.
    pub write_meta: unsafe extern "C" fn(
        handle: StoreHandle,
        meta_json: *const c_char,
        err_out: *mut *mut c_char,
    ) -> i32,

    /// Frees any `*mut c_char` this vtable returned via an out-param (`out_json`, `err_out`).
    /// Same pattern as `ChunkerVTable::free_str`.
    pub free_str: unsafe extern "C" fn(*mut c_char),

    /// Returns the ABI version this plugin was compiled against.
    pub abi_version: unsafe extern "C" fn() -> u32,
}

/// Loaded dylib store plugin with its vtable.
///
/// Unlike `DylibPlugin` (chunkers, stateless), a store plugin is stateful: loading the library and
/// creating a store *instance* are separate steps, because one plugin binary can back multiple
/// configured stores (e.g. two LanceDB tables) within one host process.
pub struct DylibStorePlugin {
    _lib: libloading::Library,
    vtable: StoreVTable,
}

impl DylibStorePlugin {
    /// Load a store dylib plugin from `path` and verify its ABI version. Does not construct a
    /// store instance — call `create_handle` next.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let lib = unsafe { libloading::Library::new(path) }
            .map_err(|e| anyhow::anyhow!("Cannot load store plugin {:?}: {e}", path))?;

        let vtable = unsafe {
            let abi_fn: libloading::Symbol<unsafe extern "C" fn() -> u32> = lib
                .get(b"virage_plugin_abi_version\0")
                .map_err(|e| anyhow::anyhow!("Missing virage_plugin_abi_version: {e}"))?;
            let version = abi_fn();
            if version != PLUGIN_ABI_VERSION {
                anyhow::bail!(
                    "Store plugin ABI version mismatch: expected {PLUGIN_ABI_VERSION}, got {version}"
                );
            }

            macro_rules! sym {
                ($name:literal) => {
                    *lib.get($name)
                        .map_err(|e| anyhow::anyhow!("Missing {}: {e}", stringify!($name)))?
                };
            }

            StoreVTable {
                create: sym!(b"virage_store_create\0"),
                destroy: sym!(b"virage_store_destroy\0"),
                initialize: sym!(b"virage_store_initialize\0"),
                upsert: sym!(b"virage_store_upsert\0"),
                delete_by_source: sym!(b"virage_store_delete_by_source\0"),
                existing_hashes: sym!(b"virage_store_existing_hashes\0"),
                current_state: sym!(b"virage_store_current_state\0"),
                search: sym!(b"virage_store_search\0"),
                list_all: sym!(b"virage_store_list_all\0"),
                read_meta: sym!(b"virage_store_read_meta\0"),
                write_meta: sym!(b"virage_store_write_meta\0"),
                free_str: sym!(b"virage_store_free_str\0"),
                abi_version: sym!(b"virage_plugin_abi_version\0"),
            }
        };

        Ok(Self { _lib: lib, vtable })
    }

    /// Access the raw vtable. Every call through it **must** be dispatched via
    /// `tokio::task::spawn_blocking` by the caller — see the module docs' "Async boundary"
    /// section. Not enforced by the type system (plain `extern "C"` fn pointers can't carry that
    /// constraint); this is a calling-convention contract, not a Rust-level guarantee.
    pub fn vtable(&self) -> &StoreVTable {
        &self.vtable
    }
}
