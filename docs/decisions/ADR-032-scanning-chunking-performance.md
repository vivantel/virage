---
id: ADR-032
title: Scanning and chunking performance + global model dir + GPU support
status: Accepted
date: 2026-06-20
---

## Context

Three independent performance and ergonomics problems were observed simultaneously:

1. **Scanning speed**: `getFileRevisions()` in `CliGitSourceRepository` was sequential. Untracked files each spawned a sequential `git hash-object` subprocess — O(N) subprocess forks, one at a time. On repos with many untracked files this limited scanning to 20–30 files/sec.

2. **Chunking throughput**: The `Orchestrator` ran file chunking in a sequential `for...of` loop.

3. **Model cache scatter**: `virage-embedder-transformers` defaulted to `~/.cache/huggingface/hub` and `virage-embedder-fastembed` defaulted to a project-local `.virage/models` path. Models downloaded to different locations per package.

4. **Progress bar stuck at 99%**: `onProgress(final, final)` fired before the render interval processed the 100% update.

5. **GPU support missing**: `virage-embedder-transformers` accepted `"cpu" | "webgpu"` but not `"cuda"`.

## Decision

**Scanning (parallel untracked file hashing):** Identify all untracked files, then hash all of them concurrently with `Promise.all([...map(file => git.raw(["hash-object", file]))])`. The main loop becomes pure `Map` lookups.

**Chunking concurrency:** Replace the sequential chunking loop with two phases:
- Phase 1: `withConcurrency(chunkTasks, chunkConcurrency)` — chunk all pending files in parallel.
- Phase 2: sequential embed/upload streaming over the collected results.

Default `chunkConcurrency` = `os.availableParallelism()`. Configurable via `options.chunkConcurrency`.

**Global model dir:** Add `getGlobalVirageDir(): string` to `virage-core` (`process.env["VIRAGE_GLOBAL_DIR"] ?? join(homedir(), ".virage")`). Both embedder packages default their model cache to `join(getGlobalVirageDir(), "models")` — i.e., `~/.virage/models`.

**Progress bar fix:** After firing `onProgress(final, final)`, yield to the event loop with `await new Promise<void>(resolve => setImmediate(resolve))`.

**GPU support:** Widen `device` type in `TransformersEmbedder` to `"cpu" | "webgpu" | "cuda"`.

## Consequences

- **+** Scanning throughput scales with `Promise.all` concurrency.
- **+** Chunking throughput scales with CPU core count.
- **+** Models shared across all virage projects at `~/.virage/models`; overridable via `VIRAGE_GLOBAL_DIR`.
- **+** Progress bar correctly reaches 100% before the pipeline summary is shown.
- **+** CUDA GPU acceleration available for environments with the GPU `onnxruntime-node` build.
- **−** Parallel chunking is a two-phase approach; minor memory increase (all chunk arrays for `chunkConcurrency` files held simultaneously before embed phase starts).
- **−** `availableParallelism()` was added in Node 18.14; guarded with fallback to `os.cpus().length`.
- **−** `"cuda"` device requires a specific `onnxruntime-node` binary — wrong binary causes a runtime error at model-load time.

## Alternatives Considered

[Not documented in original]

## References

[Not documented in original]
