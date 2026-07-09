---
id: ADR-051
title: virage-engine Rust monolith consolidates all native packages
status: Accepted
date: 2026-07-08
related: [ADR-048, ADR-050, ADR-052, ADR-053, ADR-054]
---

## Context

Virage ships 6 separate napi-rs native addon packages:
`virage-chunker-ce-{md,pdf,docx,latex,lang}` and `virage-embedder-onnx`. Each is an
independent `cdylib` crate loaded into Node.js via napi. This means 6 separate CI matrix
jobs, 6 × 5 platform stubs (30 npm packages), 6 independent Cargo dependency trees, and 6
separate publish workflows — all for functionality that is tightly coupled in practice.

The v2 migration replaces the TypeScript orchestrator with a full Rust binary. With no
Node.js process-boundary, napi is unnecessary. All chunker/embedder logic should live in a
single Rust binary compiled per platform.

## Decision

Create `crates/virage-engine` as the single Rust binary crate containing all chunker,
embedder, vector-store, pipeline, CLI, and MCP server logic. The 6 existing napi-rs packages
are deprecated; their Rust source is migrated into feature-gated modules.

**Feature flag structure:**
```toml
[features]
default         = ["chunker-all", "embedder-onnx", "store-all", "wasm-host"]
chunker-all     = ["chunker-md", "chunker-pdf", "chunker-docx", "chunker-latex", "chunker-lang"]
chunker-md      = ["dep:comrak"]
chunker-pdf     = ["dep:lopdf"]
chunker-docx    = ["dep:docx-rs"]
chunker-latex   = []
chunker-lang    = ["dep:tree-sitter", ...]
embedder-onnx   = ["dep:ort", "dep:tokenizers"]
embedder-cuda   = ["embedder-onnx", "ort/cuda"]
store-all       = ["store-lancedb", "store-qdrant", "store-postgres", "store-chromadb"]
store-lancedb   = ["dep:lancedb"]
store-qdrant    = ["dep:qdrant-client"]
store-postgres  = ["dep:sqlx"]
store-chromadb  = ["dep:reqwest"]
wasm-host       = ["dep:wasmtime", "dep:wasmtime-wasi"]
```

**Companion crates (same workspace):**
- `crates/virage-engine-sdk` — WIT guest types + convenience macros for WASM plugin authors

## Alternatives rejected

**Keep 6 separate crates as cdylib, wrap in a Rust orchestrator instead of TypeScript:** Still
requires cross-crate linking at runtime, complex FFI, and 6 CI matrix jobs. Does not simplify
distribution.

**Single binary per chunker (virage-md, virage-pdf, …):** Sub-process per file type adds IPC
overhead and process-start latency. Unworkable for hot-path throughput.

## Consequences

- 6 napi-rs packages are deprecated after v2 ships; shims emit deprecation warnings for 2
  minor versions then are removed.
- CI native-publish workflow is replaced by a single `virage-publish.yaml` with a 4-platform
  matrix (linux-x64-gnu, linux-arm64-gnu, darwin-arm64, win32-x64-msvc).
- Binary size budget: < 50 MB compressed per platform. `opt-level = "z"` + `strip = true` if
  exceeded.
- `cargo-zigbuild` (ADR-050) applies to the linux-x64-gnu build of `virage-engine`.
