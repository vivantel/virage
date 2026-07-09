---
id: ADR-054
title: CE pipeline uses direct tokio channels; Transport abstraction deferred to EE
status: Accepted
date: 2026-07-08
amended: 2026-07-09
related: [ADR-051, ADR-053]
---

## Context

The Rust pipeline (ADR-053) distributes work from a coordinator to N workers. On a single
machine this is trivially done with `tokio::sync::mpsc` channels. The coordinator and workers
share a process address space, so no serialization, acknowledgement protocol, or network hops
are required.

An earlier draft of this ADR introduced a `Transport` trait in `src/transport/` with `ack`,
`nack`, and `msg_id` semantics borrowed from message-broker protocols (NATS JetStream,
Kafka). The only implementation was `LocalTransport` — a thin wrapper that made `ack`/`nack`
no-ops. This abstraction was removed because:

- `ack`/`nack` and `msg_id` are purely distributed-systems concepts with no meaning
  in a single-process CE pipeline.
- `LocalTransport` added indirection (`Arc<dyn Transport>`) with no runtime benefit.
- The extension point for clustering belongs in EE (`virage-engine-ee`), not CE.

## Decision

The CE coordinator and worker own `tokio::sync::mpsc` channels directly. There is no
`Transport` trait, no `LocalTransport`, and no `msg_id` on work items.

**Pipeline types** live in `src/pipeline/mod.rs`:
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

**Channel wiring** (coordinator):
```rust
let (work_tx, work_rx) = mpsc::channel::<WorkItem>(workers * 4);
let (result_tx, result_rx) = mpsc::channel::<WorkResult>(workers * 8);
// spawn N worker tasks, each receives a cloned Arc<Mutex<Receiver<WorkItem>>>
```

**`--workers N` flag:** controls the number of tokio worker tasks. Default:
`std::thread::available_parallelism()`. Tokio bounded channels provide back-pressure
automatically.

When EE Phase 8 adds NATS/Kafka clustering, `virage-engine-ee` introduces the `Transport`
trait and parameterizes a new EE coordinator over it. The CE coordinator is unchanged.

## Alternatives rejected

**Keep `Transport` trait in CE as an extension point:** Introduces `ack`/`nack`/`msg_id`
EE broker concepts into CE code. The no-op `LocalTransport` wrapper adds indirection for
no benefit. The trait was removed and deferred to EE where it is actually needed.

**gRPC between coordinator and workers on the same machine:** Adds proto compilation and
serde overhead with zero benefit over in-process channels.

## Consequences

- CE pipeline has no `src/transport/` module; types live in `src/pipeline/`.
- `virage index` works offline with no external services.
- `virage index --workers N` caps concurrency at N.
- EE clustering (Phase 8) introduces its own `Transport` trait in `virage-engine-ee`;
  no CE code changes required at that point.
