# WASM Plugin Authoring Guide

Virage supports language-agnostic chunker plugins compiled to WebAssembly using the
[WASM Component Model](https://component-model.bytecodealliance.org/) (WIT / WASI Preview 2).

## How it works

Plugins implement a WIT `world` exported by `virage-engine-sdk`. The host loads the
component, passes raw file bytes through `parse()`, and receives a structured doc tree
from `chunk()`. Plugins run in a sandbox with no filesystem access.

## Prerequisites

- Rust toolchain with `wasm32-wasip2` target: `rustup target add wasm32-wasip2`
- `cargo-component`: `cargo install cargo-component`
- `virage-engine-sdk` added as a Cargo dependency

## Quick start (Rust)

### 1. Create a new component crate

```bash
cargo component new my-chunker --lib
```

### 2. Add `virage-engine-sdk` to `Cargo.toml`

```toml
[dependencies]
virage-engine-sdk = "0.1"
```

### 3. Implement the chunker world

```rust
use virage_engine_sdk::exports::virage::chunker::guest::{
    ChunkMeta, DocNode, FileInfo, Guest,
};
use virage_engine_sdk::virage_chunker_impl;

struct MyChunker;

impl Guest for MyChunker {
    fn patterns() -> Vec<String> {
        vec!["*.myext".into()]
    }

    fn parse(info: FileInfo, bytes: Vec<u8>) -> DocNode {
        let text = String::from_utf8_lossy(&bytes).into_owned();
        DocNode::document(vec![DocNode::paragraph(text)])
    }

    fn chunk(doc: DocNode, _info: FileInfo, _commit: String) -> Vec<ChunkMeta> {
        doc.paragraphs()
            .into_iter()
            .map(|p| ChunkMeta {
                dense_text: p,
                sparse_text: None,
                metadata: Default::default(),
            })
            .collect()
    }
}

virage_chunker_impl!(MyChunker);
```

### 4. Build

```bash
cargo component build --release --target wasm32-wasip2
```

The output is at `target/wasm32-wasip2/release/my_chunker.wasm`.

### 5. Smoke-test locally

```bash
virage plugin test ./target/wasm32-wasip2/release/my_chunker.wasm
```

Expected output:
```
Loading plugin: ./target/wasm32-wasip2/release/my_chunker.wasm
  init + patterns...
  Patterns: ["*.myext"]
  parse + chunk smoke test...
  Produced 1 chunk(s).
Plugin test PASSED.
```

### 6. Register in `virage.config.json`

```json
{
  "fileSets": [
    {
      "name": "custom",
      "include": ["**/*.myext"],
      "chunkers": [
        { "package": "file:.virage/plugins/my_chunker.wasm" }
      ]
    }
  ]
}
```

## Sandbox policy

| Capability | Available |
|-----------|-----------|
| Read file bytes (via `parse()`) | Yes — bytes are passed as argument |
| Filesystem access | No |
| Network access | No |
| Environment variables | No |
| Stdout / stderr | Yes — for debug logging only |

## WIT worlds reference

The authoritative WIT definitions live in
`crates/virage-engine-sdk/wit/world.wit`. Key worlds:

| World | Interface | Description |
|-------|-----------|-------------|
| `chunker` | `virage:chunker/guest` | File parser + chunk producer |
| `embedder` | `virage:embedder/guest` | Dense/sparse embedding provider |
| `reranker` | `virage:reranker/guest` | Result re-ranking |
| `source` | `virage:source/guest` | Custom document source |

## Go / AssemblyScript quickstart

Any language with WASI Preview 2 support can implement the WIT interfaces.
Generate bindings with `wit-bindgen`:

```bash
# Go
wit-bindgen go wit/ --out-dir bindings/

# AssemblyScript
wit-bindgen assemblyscript wit/ --out-dir assembly/
```

Then implement the generated interface stubs and compile to `.wasm`.

## Related

- [`virage plugin test`](../cli/validate.md) — smoke-test a plugin locally
- [ADR-052](../decisions/ADR-052-wasm-plugin-host.md) — design rationale
