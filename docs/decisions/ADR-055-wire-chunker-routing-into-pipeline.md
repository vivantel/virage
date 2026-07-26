---
id: ADR-055
title: Wire format-specific chunker routing into the live indexing pipeline
status: Accepted
date: 2026-07-26
related: [ADR-051, ADR-053, ADR-054]
---

## Context

ADR-053 specified that `pipeline/worker.rs` should "route bytes to the matching chunker
(built-in or WASM plugin)" — but this was never implemented. In practice:

- `pipeline/worker.rs::process_item` always called `raw_bytes_to_doc()` (lossy UTF-8 decode +
  `\n\n` paragraph split) for every file, regardless of format. Its `chunkers` parameter was
  `_chunkers` — unused. The `Phase 4`/`Phase 5` comment above the call site self-documented
  this as an unfinished stub from the original migration (`44c80633`, 2026-07-10).
- `bin/virage.rs::cmd_index` called `run_pipeline(..., vec![], ...)` at all three call sites —
  no chunker was ever resolved from `virage.config.json`'s `fileSets[].chunkers`.
- The `cli-binary` Cargo feature (used by the published-binary CI build, with
  `--no-default-features`) did not include `chunker-all` — so the real chunker implementations
  (`pdf.rs`, `docx.rs`, `md.rs`, `latex.rs`, `lang.rs`, all present and unit-tested) were not
  even compiled into the published binary. `chunker-all` was only reachable via `default`,
  which publish builds explicitly disable.

Net effect: `virage index` never performed format-specific chunking. A PDF or DOCX file was
read as raw bytes, lossily decoded as UTF-8, and paragraph-split — producing garbage for any
binary container format.

## Decision

1. Added `resolve_chunkers()` to `config/resolve.rs`: resolves each configured chunker
   `PluginRef` to an `Arc<dyn FileChunker>` (pdf/docx/md/latex/lang), following the same
   substring-match + `#[cfg(feature = "chunker-*")]` pattern already used by
   `resolve_store`/`resolve_source`. Deduplicates by package name across fileSets.
2. `bin/virage.rs::cmd_index` now resolves the union of all fileSets' chunker specs once and
   passes the result to all three `run_pipeline` call sites (initial index, watch-mode
   reindex, non-watch index) instead of the hardcoded `vec![]`.
3. `pipeline/worker.rs::process_item` now matches `item.path` against each resolved chunker's
   `patterns()` (first match wins, via the existing `sources::glob_match` helper), calls
   `chunker.parse(path)` to get a real `DocNode` tree plus `hash`/`size`/`modified_ms`, and
   only falls back to `raw_bytes_to_doc` when no configured chunker's patterns match. A parser
   error on a matched file (e.g. corrupt PDF) is logged and the file is skipped — it does
   *not* fall through to raw-bytes decoding, which would mangle binary formats.
4. `chunker-all` added to the `cli-binary` feature set in `Cargo.toml`, so the published
   binary actually compiles the format-specific parsers.

**Still out of scope** (separate gap, not fixed here): WASM plugin chunkers
(`plugins/wasm/chunker.rs`, per ADR-052) are still not wired into `worker.rs`'s dispatch —
`find_chunker` only searches the built-in `Arc<dyn FileChunker>` list, not the WASM registry.
Third-party/WASM chunkers remain unreachable from the live pipeline.

## Deferred follow-up (tracked here so it isn't lost)

Identified while reviewing this fix, deliberately not built in this same change:

- **Typed `ChunkMeta` struct.** `chunkers/walk.rs::ArtifactSet.metadata`,
  `pipeline::EmbeddedChunk`, and `stores::VectorDocument.metadata` all carry
  `HashMap<String, Value>` — zero compile-time field safety across ~30 known fields
  (`sourceFile`, `sheetName`, `cellReference`, `labels`, etc.). Decision: replace with a real
  `ChunkMeta` struct, full field set (not just `labels`), threaded through the pipeline.
  Storage stays a single serialized JSON column for now (see next point) — this is a
  compile-time-safety change, not a storage schema change.
- **Native `labels` query-pushdown filtering, deferred until Phase 4/5's auth-claim system
  exists.** `stores::SearchOptions.filter`/`tag_filter` are declared but completely unused —
  e.g. `stores/lancedb.rs::search()` takes `_opts: SearchOptions`. All four store adapters
  serialize `metadata` into a single opaque JSON column (`metadata_json` in LanceDB); there is
  no per-field query pushdown for *anything* today, not just `labels`. Do not add a `labels`
  column with query-level filtering before the auth-claim system that decides *which* labels a
  requester may see — an RBAC-shaped column with no enforcement behind it is worse than not
  having it. Build both together when Phase 4 (license/claims) lands.
- **Chunker-options preset system.** No config mechanism exists to define a named, reusable
  bundle of chunker windowing options (`maxTokens`/`minTokens`/`overlap`/`adaptiveSize`/
  `recursive`) and reference it from multiple fileSets — every fileSet duplicates the full
  options object inline (`config/mod.rs::FileSetConfig.chunkers: Vec<PluginRef>`, each with its
  own inline `options`). `PipelineConfig.strategy` is currently a hardcoded `"window"` literal
  (`pipeline/mod.rs:88,323`) with zero consumers — `bin/virage.rs::cmd_chunks_report` doesn't
  even group by it (unlike the deprecated TS `chunks-report.ts`, which did). Once a preset
  system exists, `strategy` should be set to the preset name that produced each chunk instead
  of the dead literal.

## Consequences

- `virage.config.json` fileSets referencing a chunker feature not compiled into the binary now
  fail with a clear `anyhow` error (`"chunker-pdf feature not compiled in"`) instead of
  silently falling back to raw-bytes chunking.
- **Any index built before this fix used raw-bytes-only chunking for every file**, regardless
  of the configured format chunkers. Existing `.virage` databases should be rebuilt with
  `virage index --force` to get real structural chunks (headings, tables, page numbers) for
  PDF/DOCX/MD/LaTeX/code files.
