---
id: ADR-053
title: Full Rust tokio pipeline replaces TypeScript orchestrator
status: Proposed
date: 2026-07-08
related: [ADR-002, ADR-049, ADR-051, ADR-054]
---

## Context

The current pipeline is orchestrated by TypeScript (`virage-core/src/core/orchestrator.ts`)
and coordinates Node.js workers via a `Semaphore`-based concurrency limiter. Chunking and
embedding are delegated to napi-rs native addons (6 packages). The boundary between
TypeScript and Rust involves V8 serialization of chunk data (`Buffer` → JSON →
`Vec<u8>` back across napi), which adds overhead and limits throughput.

With `crates/virage-engine` (ADR-051) being a full Rust binary, the TypeScript process
boundary is eliminated. The pipeline can run as pure async Rust (tokio) with zero FFI in
the hot path.

## Decision

Port the four-stage pipeline (ADR-002) to Rust, implemented in `crates/virage-engine`:

**`SourceProvider` trait** (`src/sources/mod.rs`):
```rust
pub trait SourceProvider: Send + Sync {
    fn name(&self) -> &str;
    fn provider_type(&self) -> &str;
    async fn current_revision(&self) -> Result<String>;
    async fn file_revisions(&self, paths: &[&str]) -> Result<HashMap<String, String>>;
    async fn changed_since(&self, rev: &str) -> Result<Option<ChangedFiles>>;
    fn list_all(&self, filter: Option<SourceFilter>) -> BoxStream<Result<SourceItem>>;
    async fn read_content(&self, path: &str, range: Option<ByteRange>) -> Result<Bytes>;
}
```
`read_content()` implements ADR-049's content-streaming contract in Rust. Providers never
expose raw file paths to workers; workers call `read_content()` via the trait.

**CE source providers:**
- `GitSourceProvider` (`git2` crate): per-file blob SHA for change detection (same semantics
  as ADR-004); CODEOWNERS label injection; `list_all()` streams git-tracked files.
- `LocalFsSourceProvider` (`walkdir`): SHA-256 of (path, mtime) pairs as revision; full scan
  on every run (no history).

**Pipeline flow** (`src/pipeline/`):
1. `coordinator.rs`: calls `source_provider.list_all()`, compares `file_revisions()` vs
   SQLite state, pushes `WorkItem`s onto a bounded channel (cap = `workers × 4`).
2. `worker.rs` (N tokio tasks): pulls `WorkItem`, calls `read_content()`, routes bytes to
   the matching chunker (built-in or WASM plugin), calls `embedder.embed_batch()`, pushes
   `EmbeddedChunk` onto result channel.
3. Coordinator collects `EmbeddedChunk`s and batches them to `vector_store.upsert()` every
   `upload_batch_size` chunks (ADR-022 incremental upsert equivalent).

**Back-pressure:** Tokio bounded channels (`mpsc::channel(cap)`) block naturally when full.
The JS `Semaphore` is unnecessary.

**`walkToChunks` port** (`src/chunkers/walk.rs`):
Ports the hot-path tree traversal from `virage-chunker-ce-ast/src/chunker.ts` to Rust:
- `walkDocNode()` with arena-allocated segment accumulation
- Window splitting with overlap and breadcrumb accumulation
- Adaptive size halving (`adaptiveFactor`)
- Token estimation (`bytes.len() / 4`)
- `sparseTextGeneratorId`/`metadataGeneratorId` = sha256(name + version + config fingerprint)
- `denseTextHash` = sha256(denseText)[0..16]
- `pageNumber` propagation for PDF chunks
Parity test: same ViDoc JSON → same `Vec<Chunk>` (compare `dense_text_hash` sets).

**SQLite state** (`src/db/mod.rs`): `rusqlite` replaces `better-sqlite3`. Same schema:
`file_revisions`, `chunks`, `schema_migrations` (STRICT mode, forward-only migrations).

**`workers` config:** default `std::thread::available_parallelism()`; cap = CPU core count.

## Alternatives rejected

**Tokio-based orchestrator calling napi packages via subprocess:** Eliminates the napi
V8 serialization overhead but requires inter-process communication (pipe/socket), adding
latency and complexity. Not faster than in-process trait calls.

**Keep TypeScript orchestrator, call Rust via stdin/stdout:** Same IPC overhead. Loses the
ability to share zero-copy `Bytes` across chunker → embedder.

## Consequences

- TypeScript packages `virage-core`, `virage-cli`, `virage-mcp` are deprecated (Phase 9).
- The `walkToChunks` port must pass a fixture parity test (same `dense_text_hash` set)
  before Phase 4 is considered complete.
- Throughput target: ≥ 2× vs TypeScript baseline on a 1000-file repo (benchmark in Phase 4
  checkpoint).
- The `SourceProvider` trait is the extension point for additional source types.
