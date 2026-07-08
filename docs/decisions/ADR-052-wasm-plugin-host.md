---
id: ADR-052
title: WASM Component Model plugin host using wasmtime
status: Proposed
date: 2026-07-08
related: [ADR-051]
---

## Context

Third-party developers need a way to extend Virage with custom chunkers, embedders,
rerankers, and source providers without compiling against Virage's Rust ABI or depending on
Rust tooling at all. The extension point must be:

1. Language-agnostic (Rust, Go, AssemblyScript, C, etc.)
2. Safely sandboxed — a misbehaving plugin cannot read arbitrary files or crash the host
3. Versionable — the contract can evolve with a clear upgrade path

## Decision

Use **wasmtime** (Component Model, WASI preview2) as the plugin host. Plugins are `.wasm`
files compiled to the `wasm32-wasip2` target implementing a defined WIT world.

**WIT worlds** (`wit/worlds/`): `chunker`, `embedder`, `reranker`, `source` (see
`wit/virage-engine.wit` for full spec). Each world exports a small set of pure functions
(no callbacks, no async across boundary).

**Sandbox policy:**
- Host passes file bytes via the `parse(info, bytes)` WIT call; plugin never receives a file
  path and cannot call `open()` on the host FS. Capability: bytes-in only, no ambient FS.
- `ResourceLimiter`: 512 MB memory ceiling, 10-second CPU timeout per invocation. Configurable
  via `virage.config.json`.
- WASI preview2: networking and clock capabilities are not granted by default.

**Host implementation** (`src/plugins/wasm/host.rs`):
- Single shared `wasmtime::Engine` (async mode, compiled once at startup)
- `WasmRegistry`: `Arc<RwLock<HashMap<PathBuf, Arc<LoadedPlugin>>>>`, LRU eviction
- `wit_bindgen::generate!` for host-side bindings

**Plugin discovery** (in priority order):
1. Config field: `"plugin": "file:.virage/plugins/my.wasm"` in a fileSet chunker entry
2. Project-local: `.virage/plugins/*.wasm`
3. Global: `~/.virage/plugins/*.wasm`
4. npm: packages with `"wasm-plugin": "file:./plugin.wasm"` in `package.json`

**SDK** (`crates/virage-engine-sdk`): published on crates.io with WIT-generated guest types
and `virage_chunker_impl!` macro. Getting-started guide covers Rust, Go, AssemblyScript.

## Alternatives rejected

**Lua/WASM scripting without Component Model:** Simpler but loses the type-safe WIT contract
and cross-language support. Component Model's canonical ABI is the industry standard.

**Rhai embedded scripting:** Fast but Rust-only; no cross-language story.

**wasmtime vs. wasmer:** wasmtime is the reference implementation for WASI preview2 and the
Component Model. Better toolchain integration via `cargo-component` and `wit-bindgen`.

## Consequences

- `wasmtime` + `wasmtime-wasi` are dependencies behind the `wasm-host` feature flag (enabled
  in `default` features).
- Plugin authors can use any language that compiles to `wasm32-wasip2`.
- WIT worlds are versioned as part of `virage:engine@2.0.0`. Breaking WIT changes increment
  the major version and require an explicit migration path.
- The `wasm-host` feature can be disabled (`--no-default-features`) for minimal builds.
