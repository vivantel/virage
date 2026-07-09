use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use anyhow::anyhow;
use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

pub mod chunker;
pub mod discovery;

// ─── WIT host bindings ────────────────────────────────────────────────────────
// Uses the consolidated WIT from virage-engine-sdk (flat layout, no subdirs).

wasmtime::component::bindgen!({
    world: "chunker",
    path: "../virage-engine-sdk/wit",
});

// ─── WASI host state ─────────────────────────────────────────────────────────

/// Per-call state stored in the wasmtime Store.
pub struct HostState {
    wasi: WasiCtx,
    table: ResourceTable,
    limiter: PluginLimits,
}

// wasmtime-wasi 46: WasiView has a single `ctx()` method returning WasiCtxView.
impl WasiView for HostState {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

// ─── Resource limiter ─────────────────────────────────────────────────────────

pub struct PluginLimits {
    max_memory_bytes: usize,
}

impl Default for PluginLimits {
    fn default() -> Self {
        Self {
            max_memory_bytes: 512 * 1024 * 1024, // 512 MB
        }
    }
}

impl wasmtime::ResourceLimiter for PluginLimits {
    fn memory_growing(
        &mut self,
        _current: usize,
        desired: usize,
        _maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        Ok(desired <= self.max_memory_bytes)
    }

    fn table_growing(
        &mut self,
        _current: usize,
        desired: usize,
        _maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        Ok(desired <= 100_000)
    }
}

// ─── Loaded plugin ────────────────────────────────────────────────────────────

/// A compiled and linked WASM component ready for instantiation.
pub struct LoadedPlugin {
    pub path: PathBuf,
    pub component: Component,
    pub engine: Arc<Engine>,
}

impl LoadedPlugin {
    pub fn from_file(engine: &Arc<Engine>, path: &Path) -> anyhow::Result<Self> {
        let component = Component::from_file(engine, path)
            .map_err(|e| anyhow!("failed to load WASM component {:?}: {e}", path))?;
        Ok(Self {
            path: path.to_owned(),
            component,
            engine: Arc::clone(engine),
        })
    }

    pub fn from_bytes(engine: &Arc<Engine>, path: PathBuf, bytes: &[u8]) -> anyhow::Result<Self> {
        let component = Component::from_binary(engine, bytes)
            .map_err(|e| anyhow!("failed to load WASM component bytes: {e}"))?;
        Ok(Self {
            path,
            component,
            engine: Arc::clone(engine),
        })
    }
}

// ─── WASM plugin host ─────────────────────────────────────────────────────────

/// Shared wasmtime engine + linker.  One per process; cheap to clone (Arc inside).
#[derive(Clone)]
pub struct WasmPluginHost {
    engine: Arc<Engine>,
    linker: Arc<Linker<HostState>>,
}

impl WasmPluginHost {
    pub fn new() -> anyhow::Result<Self> {
        let mut config = Config::new();
        config.wasm_component_model(true);

        let engine = Arc::new(Engine::new(&config)?);
        let mut linker: Linker<HostState> = Linker::new(&engine);

        // WASI preview2: plugins get stderr for logging but no FS access.
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker)?;

        Ok(Self {
            engine,
            linker: Arc::new(linker),
        })
    }

    /// Create a sandboxed Store for a single call.
    ///
    /// No preopened directories → plugins cannot access the host filesystem.
    pub fn make_store(&self, max_memory_bytes: Option<usize>) -> Store<HostState> {
        let wasi = WasiCtxBuilder::new().inherit_stderr().build();

        let state = HostState {
            wasi,
            table: ResourceTable::new(),
            limiter: PluginLimits {
                max_memory_bytes: max_memory_bytes.unwrap_or(512 * 1024 * 1024),
            },
        };

        let mut store = Store::new(&self.engine, state);
        store.limiter(|s| &mut s.limiter);
        store
    }

    pub fn engine(&self) -> &Arc<Engine> {
        &self.engine
    }

    pub fn linker(&self) -> &Arc<Linker<HostState>> {
        &self.linker
    }
}

impl Default for WasmPluginHost {
    fn default() -> Self {
        Self::new().expect("failed to create WasmPluginHost")
    }
}

// ─── Plugin registry ─────────────────────────────────────────────────────────

const DEFAULT_MAX_CACHED: usize = 32;

/// Thread-safe cache of compiled WASM components with LRU eviction.
#[derive(Clone)]
pub struct WasmRegistry {
    cache: Arc<RwLock<HashMap<PathBuf, Arc<LoadedPlugin>>>>,
    order: Arc<RwLock<VecDeque<PathBuf>>>,
    max_cached: usize,
    host: WasmPluginHost,
}

impl WasmRegistry {
    pub fn new(host: WasmPluginHost) -> Self {
        Self::with_capacity(host, DEFAULT_MAX_CACHED)
    }

    pub fn with_capacity(host: WasmPluginHost, max_cached: usize) -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            order: Arc::new(RwLock::new(VecDeque::new())),
            max_cached,
            host,
        }
    }

    /// Load (or retrieve cached) a plugin from a path.
    pub fn load(&self, path: &Path) -> anyhow::Result<Arc<LoadedPlugin>> {
        {
            let cache = self.cache.read().unwrap();
            if let Some(p) = cache.get(path) {
                return Ok(Arc::clone(p));
            }
        }
        let plugin = Arc::new(LoadedPlugin::from_file(self.host.engine(), path)?);
        self.insert(path.to_owned(), Arc::clone(&plugin));
        Ok(plugin)
    }

    /// Load from raw bytes (used in tests).
    pub fn load_bytes(&self, path: PathBuf, bytes: &[u8]) -> anyhow::Result<Arc<LoadedPlugin>> {
        let plugin = Arc::new(LoadedPlugin::from_bytes(
            self.host.engine(),
            path.clone(),
            bytes,
        )?);
        self.insert(path, Arc::clone(&plugin));
        Ok(plugin)
    }

    fn insert(&self, path: PathBuf, plugin: Arc<LoadedPlugin>) {
        let mut cache = self.cache.write().unwrap();
        let mut order = self.order.write().unwrap();

        if cache.len() >= self.max_cached {
            if let Some(evict) = order.pop_front() {
                cache.remove(&evict);
            }
        }
        cache.insert(path.clone(), plugin);
        order.push_back(path);
    }

    pub fn host(&self) -> &WasmPluginHost {
        &self.host
    }
}

#[cfg(test)]
mod tests;
