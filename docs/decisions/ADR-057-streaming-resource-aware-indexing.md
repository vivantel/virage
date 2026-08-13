---
id: ADR-057
title: Streaming indexing pipeline + resource-aware concurrency
status: Accepted
date: 2026-08-13
supersedes: ADR-054
related: [ADR-051, ADR-053, ADR-054]
---

## Context

`virage index` was OOM-killed twice by the kernel on a memory-constrained development host
(3.7GB total RAM, shared with other processes) while indexing a small corpus (~400 TS/Rust/
Markdown files) with a 384-dim, ~130MB ONNX embedder. ~2.5GB RSS for that input size is
disproportionate — this is a small-corpus problem on a constrained host, not a large-corpus
scaling problem.

Investigation found no leak or duplication bug — the embedder is a correctly-shared singleton,
and channel/batch sizes are bounded. Two real gaps were found instead:

1. Each file's full set of chunks, and the resulting embedded chunks, are fully materialized in
   memory before any of it reaches the store — chunking and embedding happen "all at once per
   file," and the multiplier across concurrent workers is unbounded against actual available
   memory.
2. Worker count defaults to CPU core count (`available_parallelism()`), not available memory. On
   a shared host, core count says nothing about whether there is room for another worker's
   embedding batch. `ADR-054`'s stated consequence "bounded channels prevent OOM" is contradicted
   by this incident: bounded channels bound how much work is *queued*, not how much memory each
   in-flight item's embedding costs.

A related, non-bug gap: the ONNX Runtime session is constructed with no explicit memory/thread
configuration, relying on ORT's unbounded default arena allocator — plausible as a contributing
factor, not confirmed by profiling.

## Decision

Rework the per-file chunk→embed→upload path into a true stream: chunks flow through the
`Embedder`/`VectorStore` boundary incrementally rather than being fully buffered per file, with a
small bounded micro-batch floor retained before each store write (each store commit is a full
manifest commit, not a cheap append, so unbounded per-chunk writes would trade an OOM risk for a
throughput collapse).

Replace the static, core-count-only worker default with a pluggable `ConcurrencyStrategy`
abstraction with two implementations: `FixedWorkers` (today's `available_parallelism()`-or-
explicit-`--workers N` behavior, kept as an opt-out), and `RamSampling` (the new default — samples
free/available system RAM at startup and continuously during the run, scaling the active worker
count down to fully sequential under real pressure and back up as headroom returns). The strategy
is trait-based so it is unit-testable without reproducing real memory pressure, and swappable
later for a different signal (e.g. a cgroup memory limit) without touching coordinator control
flow.

Explicitly bound the ONNX Runtime session's memory/thread footprint at construction time rather
than relying on unbounded defaults.

This supersedes `ADR-054`: its "bounded channels prevent OOM" consequence no longer holds, and its
static concurrency model is replaced by `ConcurrencyStrategy`.

## Consequences

- **+** Peak memory during indexing is bounded by actual available headroom instead of blind to
  it — directly prevents a repeat of this incident on shared/constrained hosts.
- **+** `ConcurrencyStrategy` is independently testable and swappable without touching the
  coordinator's control flow.
- **−** Streaming with a small micro-batch floor issues more store-commit calls than the previous
  fixed-batch approach under low-memory conditions — trades throughput for safety when memory is
  tight; not a regression when memory is ample.
- **−** New dependency (`sysinfo` or equivalent) for RAM sampling — evaluated against the standard
  dependency checklist (MSRV, all cross-compilation targets, native deps) before adoption.

## Alternatives Considered

- **Keep `ADR-054`'s static core-count default, just lower it.** Rejected: a lower fixed default
  still can't react to memory pressure that varies at runtime from other processes on a shared
  host: it either wastes headroom when memory is ample or still risks OOM when it isn't.
- **Inline resource-awareness directly in the coordinator instead of a trait.** Rejected: couples
  concurrency policy to control flow and makes the low-memory path untestable without reproducing
  real memory pressure; a trait boundary allows an injectable memory source for deterministic unit
  tests.
- **Abort and respawn in-flight workers to scale down immediately.** Rejected in favor of workers
  self-checking the strategy between items: aborting mid in-flight operation risks losing
  in-progress work or leaving the store in a partially-committed state; self-checking has more
  reaction latency but never cancels mid-operation.

## References

- Prior decision: `ADR-054` (superseded by this ADR).
- Incident evidence and full investigation rationale: `virage-ee` repo,
  `docs/ai/facts/virage-indexing-oom-incident.md` and
  `docs/decisions/IR-047-streaming-resource-aware-indexing.md` (cross-repo — virage-ee owns the
  incident record; this ADR is CE's own decision record for the code-level fix).
