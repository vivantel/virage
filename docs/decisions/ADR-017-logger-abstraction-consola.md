---
id: ADR-017
title: Logger abstraction with consola and stackable -v verbosity
status: Accepted
date: 2026-06-02
---

## Context

Raw `console.*` calls were scattered across the pipeline and all plugin packages. There was no way to silence output in tests or increase verbosity in debugging sessions without editing source code.

## Decision

Introduce a `Logger` interface with two implementations: `ConsolaLogger` (wraps `consola`, default) and `NullLogger` (silences all output). The CLI exposes a stackable `-v` flag (0–5 levels); the resolved log level is passed to `createLogger(verbosity)` and threaded through `Orchestrator` and all pipeline stages. All plugin packages add a `setLogger(logger: Logger)` method so the orchestrator can propagate the logger without coupling plugins to a specific logging library.

## Consequences

- **+** Tests can use `NullLogger` to silence pipeline output without I/O redirection.
- **+** `-vvv` gives progressively more detailed output without code changes.
- **+** Plugins remain decoupled from any specific logging library.
- **−** All plugin packages needed updating to accept `setLogger()`.

## Alternatives Considered

[Not documented in original]

## References

[Not documented in original]
