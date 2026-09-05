//! Dylib-plugin host: loads `cdylib` plugins (chunkers, and vector store/embedder backends) via a
//! plain `#[repr(C)]` + `extern "C"` ABI, version-checked at load time.
//!
//! Lives here rather than in a downstream consumer crate because any host process that wants to
//! load a given plugin `.so` (e.g. `virage-plugin-lancedb`) needs to agree on the exact same
//! vtable shape — keeping one definition here, that all consumers depend on, avoids two
//! independently-maintained copies of the same ABI contract drifting apart.

use std::path::Path;

pub mod embedder;
pub mod store;

/// ABI version this host expects from dylib plugins.
pub const PLUGIN_ABI_VERSION: u32 = 2;

/// Raw function pointer table for a dylib chunker plugin.
/// All functions use `extern "C"` for stable ABI across compiler versions.
#[repr(C)]
pub struct ChunkerVTable {
    /// Returns comma-separated glob patterns this chunker handles.
    pub patterns: unsafe extern "C" fn() -> *const std::ffi::c_char,
    /// Frees the string returned by `patterns`.
    pub free_str: unsafe extern "C" fn(*mut std::ffi::c_char),
    /// Returns the ABI version this plugin was compiled against.
    pub abi_version: unsafe extern "C" fn() -> u32,
}

/// Loaded dylib plugin with its vtable.
pub struct DylibPlugin {
    _lib: libloading::Library,
    pub vtable: ChunkerVTable,
}

impl DylibPlugin {
    /// Load a dylib plugin from `path`, verify ABI version, and return the handle.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let lib = unsafe { libloading::Library::new(path) }
            .map_err(|e| anyhow::anyhow!("Cannot load plugin {:?}: {e}", path))?;

        let vtable = unsafe {
            let abi_fn: libloading::Symbol<unsafe extern "C" fn() -> u32> = lib
                .get(b"virage_plugin_abi_version\0")
                .map_err(|e| anyhow::anyhow!("Missing virage_plugin_abi_version: {e}"))?;
            let version = abi_fn();
            if version != PLUGIN_ABI_VERSION {
                anyhow::bail!(
                    "Plugin ABI version mismatch: expected {PLUGIN_ABI_VERSION}, got {version}"
                );
            }

            let patterns: libloading::Symbol<unsafe extern "C" fn() -> *const std::ffi::c_char> =
                lib.get(b"virage_patterns\0")
                    .map_err(|e| anyhow::anyhow!("Missing virage_patterns: {e}"))?;
            let free_str: libloading::Symbol<unsafe extern "C" fn(*mut std::ffi::c_char)> = lib
                .get(b"virage_free_str\0")
                .map_err(|e| anyhow::anyhow!("Missing virage_free_str: {e}"))?;
            let abi_version: libloading::Symbol<unsafe extern "C" fn() -> u32> = lib
                .get(b"virage_plugin_abi_version\0")
                .map_err(|e| anyhow::anyhow!("Missing virage_plugin_abi_version: {e}"))?;

            ChunkerVTable {
                patterns: *patterns,
                free_str: *free_str,
                abi_version: *abi_version,
            }
        };

        Ok(Self { _lib: lib, vtable })
    }

    /// Return the glob patterns this plugin handles.
    pub fn patterns(&self) -> Vec<String> {
        let raw = unsafe { (self.vtable.patterns)() };
        if raw.is_null() {
            return Vec::new();
        }
        let s = unsafe { std::ffi::CStr::from_ptr(raw) }
            .to_string_lossy()
            .into_owned();
        unsafe { (self.vtable.free_str)(raw as *mut _) };
        s.split(',').map(str::trim).map(str::to_string).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::PLUGIN_ABI_VERSION;

    #[test]
    fn abi_version_is_nonzero() {
        assert!(PLUGIN_ABI_VERSION > 0);
    }
}
