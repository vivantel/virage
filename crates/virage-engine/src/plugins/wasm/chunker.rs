use std::path::Path;
use std::sync::Arc;

use anyhow::{anyhow, Result};

use super::{Chunker, HostState, LoadedPlugin, WasmPluginHost, WasmRegistry};
use crate::plugins::wasm::{Chunk, FileInfo};

/// Adapter that wraps a WASM chunker component and exposes a synchronous
/// chunking interface for use in the pipeline.
pub struct WasmChunkerAdapter {
    plugin: Arc<LoadedPlugin>,
    host: WasmPluginHost,
    config_json: String,
}

impl WasmChunkerAdapter {
    /// Load the chunker from a file path (path may be cached in the registry).
    pub fn from_path(registry: &WasmRegistry, path: &Path, config_json: &str) -> Result<Self> {
        let plugin = registry.load(path)?;
        Ok(Self {
            plugin,
            host: registry.host().clone(),
            config_json: config_json.to_owned(),
        })
    }

    /// Load from raw bytes (used in tests).
    pub fn from_bytes(
        registry: &WasmRegistry,
        label: &str,
        bytes: &[u8],
        config_json: &str,
    ) -> Result<Self> {
        let plugin = registry.load_bytes(label.into(), bytes)?;
        Ok(Self {
            plugin,
            host: registry.host().clone(),
            config_json: config_json.to_owned(),
        })
    }

    /// Initialize the plugin and return the glob patterns it handles.
    pub fn init_and_patterns(&self) -> Result<Vec<String>> {
        let mut store = self.host.make_store(None);
        let chunker = self.instantiate(&mut store)?;

        chunker
            .call_init(&mut store, &self.config_json)
            .map_err(|e| anyhow!("call_init trap: {e}"))?
            .map_err(|e| anyhow!("init error: {e}"))?;

        let patterns = chunker
            .call_patterns(&mut store)
            .map_err(|e| anyhow!("call_patterns trap: {e}"))?;
        Ok(patterns)
    }

    /// Parse raw bytes into a ViDoc JSON string.
    pub fn parse(&self, info: &FileInfo, bytes: &[u8]) -> Result<String> {
        let mut store = self.host.make_store(None);
        let chunker = self.instantiate(&mut store)?;

        chunker
            .call_parse(&mut store, info, bytes)
            .map_err(|e| anyhow!("call_parse trap: {e}"))?
            .map_err(|e| anyhow!("parse error: {e}"))
    }

    /// Convert a ViDoc JSON into chunks.
    pub fn chunk(&self, doc_json: &str, info: &FileInfo, commit_hash: &str) -> Result<Vec<Chunk>> {
        let mut store = self.host.make_store(None);
        let chunker = self.instantiate(&mut store)?;

        chunker
            .call_chunk(&mut store, doc_json, info, commit_hash)
            .map_err(|e| anyhow!("call_chunk trap: {e}"))?
            .map_err(|e| anyhow!("chunk error: {e}"))
    }

    fn instantiate(&self, store: &mut wasmtime::Store<HostState>) -> Result<Chunker> {
        let instance = self
            .host
            .linker()
            .instantiate(&mut *store, &self.plugin.component)
            .map_err(|e| anyhow!("instantiate component: {e:?}"))?;
        Chunker::new(store, &instance).map_err(|e| anyhow!("Chunker::new: {e:?}"))
    }
}
