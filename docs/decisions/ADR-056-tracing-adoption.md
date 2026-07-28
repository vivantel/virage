---
id: ADR-056
title: Structured logging via tracing + tracing-subscriber
status: Accepted
date: 2026-07-28
related: [ADR-051]
---

## Context

No logging framework existed anywhere in the Rust codebase — diagnostics were ad-hoc
`println!`/`eprintln!` calls, some prefixed `[virage]`/`[virage-engine]` to approximate
warn/error levels. This gave operators no way to control verbosity, no structured fields to
filter/query on, and no path to a remote log sink (a capability being designed separately for a
downstream, non-open-source build).

## Decision

Adopt `tracing` + `tracing-subscriber` for structured logging, CE-scope only (stdout + optional
append-only file, no remote transport, no rotation — those are out of scope for this ADR).

**Subscriber init** — `virage_engine::logging::init(config)` (`src/logging.rs`) builds an
env-filtered registry with a JSON stdout layer and an optional JSON file layer. `RUST_LOG`
overrides `virage.config.json`'s `logging.level` when set (standard `tracing` convention); no
generic nested env-override scheme was introduced. `logging::registry(config)` is exposed
separately (not just `init`) so a downstream binary can attach additional `Layer`s via
`.with(layer)` before calling `.init()` — this crate makes no assumption about what those layers
are.

**Config shape** — new optional `logging` block in `VirageConfigJson`:
```jsonc
{
  "logging": {
    "level": "info",           // EnvFilter directive string; default "info" when block is absent
    "transports": []            // opaque to CE — parsed but not interpreted; see below
  }
}
```
`level` is a plain string parsed via `tracing_subscriber::EnvFilter`, not a typed enum — this
gets per-module directive syntax (`"virage_engine=debug,warn"`) for free, on the same parse path
as `RUST_LOG`.

`transports` is accepted and passed through by the parser but never read by CE — its shape is
sink-specific and left for a downstream consumer to define and resolve, the same pattern
`PluginRef.options` already uses for plugin-specific config.

**Migration of existing print-style diagnostics** — the `[virage]`/`[virage-engine]`-prefixed
warn/error `eprintln!` call sites (CLI serve-command auth-token warning, pipeline worker
skip/failure diagnostics) were migrated to `tracing::warn!`. Interactive CLI UX output
(`output.rs`'s formatted human/JSON command output, the `watch` subcommand's progress lines) was
left as-is — that is presentation, not a logging diagnostic, and continues to go through `Out`.

## Alternatives rejected

**`log` + `env_logger`**: smaller dependency footprint, but no structured spans/fields and no
`tracing-opentelemetry` bridge — would mean adopting a second instrumentation framework if
OTEL export is ever built on top of this. Rejected in favor of the framework with a clear
upgrade path.

## Consequences

- `tracing`/`tracing-subscriber` become real CE dependencies (already present as optional,
  `cli-binary`-gated deps; this ADR is what turns them from unused to load-bearing).
- The `pipeline` feature now also pulls in `dep:tracing` (previously only `cli-binary` did) so
  `virage-engine/src/pipeline/worker.rs` can log without requiring the full CLI feature set.
- `virage.config.json`'s `VirageConfigJson` gains one new optional top-level field
  (`logging`) — non-breaking, no `VIRAGE_CONFIG_SCHEMA_VERSION` bump required.
- No file-writer rotation ships in this change — append-only, external rotation is the
  customer's responsibility (documented as a known limitation, not a bug).
