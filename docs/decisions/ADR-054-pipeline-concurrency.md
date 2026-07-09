---
id: ADR-054
title: Multi-worker pipeline concurrency via bounded tokio channels
status: Accepted
date: 2026-07-08
amended: 2026-07-09
related: [ADR-051, ADR-053]
---

## Context

The Rust pipeline (ADR-053) distributes work from a coordinator to N workers. On a single
machine all components share a process address space, so no serialization or network hops
are required — `tokio::sync::mpsc` channels are sufficient and optimal.

An earlier draft introduced a `Transport` trait with `ack`, `nack`, and `msg_id` semantics
borrowed from message-broker protocols. These concepts have no meaning in a single-process
pipeline: `ack`/`nack` were no-ops and `msg_id` on `WorkItem` was set but never consumed.
The abstraction was removed.

## Decision

The coordinator owns two bounded `mpsc` channels and passes channel ends to worker tasks at
startup. No trait abstraction wraps this.

**Pipeline types** (`src/pipeline/mod.rs`):
```rust
pub struct WorkItem {
    pub path: String,
    pub revision: String,
    pub labels: Vec<String>,
}
pub struct WorkResult {
    pub path: String,
    pub chunks: Vec<EmbeddedChunk>,
}
```

**Channel setup** (coordinator):
```rust
let (work_tx, work_rx) = mpsc::channel::<WorkItem>(workers * 4);
let (result_tx, result_rx) = mpsc::channel::<WorkResult>(workers * 8);
// spawn N worker tasks, each receives Arc<Mutex<Receiver<WorkItem>>> + Sender<WorkResult>
```

**Back-pressure:** `send().await` blocks when the bounded channel is full. Workers naturally
throttle the coordinator without any explicit semaphore.

**`--workers N` flag:** controls task count. Default: `std::thread::available_parallelism()`.

## Alternatives rejected

**Abstract channel interface:** Wrapping `mpsc` behind a trait introduces protocol concepts
(`ack`, `nack`, message IDs) that have no meaning in a single-process pipeline and add
indirection for zero benefit.

**gRPC between coordinator and workers:** Adds proto compilation and serde overhead with no
benefit over in-process channels on the same machine.

## Consequences

- Pipeline types (`WorkItem`, `WorkResult`, `EmbeddedChunk`) live in `src/pipeline/`.
- `virage index` works offline with no external services.
- `virage index --workers N` saturates available cores; bounded channels prevent OOM.
