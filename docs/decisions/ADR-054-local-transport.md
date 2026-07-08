---
id: ADR-054
title: LocalTransport as the built-in single-machine pipeline transport
status: Proposed
date: 2026-07-08
related: [ADR-051, ADR-053]
---

## Context

The Rust pipeline (ADR-053) distributes work from a coordinator to N workers. On a single
machine this is trivially done with tokio `mpsc` channels. The coordinator and workers share
a process address space, so no serialization or network hops are required.

The pipeline needs a well-defined `Transport` abstraction so the coordinator and worker code
are not hard-coded to a specific delivery mechanism, and so additional transport backends can
be supplied without modifying the core pipeline.

## Decision

Define a `Transport` trait in `src/transport/mod.rs` and implement `LocalTransport` as the
built-in single-machine transport.

**`Transport` trait:**
```rust
pub trait Transport: Send + Sync + 'static {
    async fn push_work(&self, item: &WorkItem) -> Result<()>;
    async fn pull_work(&self) -> Result<Option<WorkItem>>;
    async fn push_result(&self, result: &WorkResult) -> Result<()>;
    async fn pull_result(&self) -> Result<Option<WorkResult>>;
    async fn ack(&self, msg_id: &str) -> Result<()>;
    async fn nack(&self, msg_id: &str) -> Result<()>;
}
```
`WorkItem` and `WorkResult` are JSON-serialized so the wire format is transport-agnostic.

**`LocalTransport`** (`src/transport/local.rs`): two `tokio::sync::mpsc::channel` pairs (work
+ result). `ack`/`nack` are no-ops — in-process delivery never loses messages.

`LocalTransport` is the only built-in transport. It is selected automatically when no
`pipeline.transport` config key is set (the default).

**`--workers N` flag:** controls the number of tokio worker tasks pulling from the work
channel. Default: `std::thread::available_parallelism()`.

## Alternatives rejected

**Hard-code `mpsc` channels in coordinator/worker:** Works identically but couples the
pipeline to a single delivery mechanism, preventing future extension without refactoring.

**gRPC between coordinator and workers on the same machine:** Adds proto compilation and
serde overhead with zero benefit over in-process channels.

## Consequences

- `LocalTransport` requires no external services — `virage index` works offline.
- The `Transport` trait is the extension point for any additional transport backends.
- `virage index --workers N` caps concurrency at N; tokio bounded channels provide
  back-pressure automatically.
