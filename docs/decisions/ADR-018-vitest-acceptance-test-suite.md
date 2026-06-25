---
id: ADR-018
title: Vitest acceptance test suite in test/acceptance/
status: Accepted
date: 2026-06-03
---

## Context

The prior shell-script e2e test was not integrated with CI, produced no structured output, had no per-test isolation, and required manual inspection to determine pass/fail.

## Decision

Replace the shell script with a Vitest-based acceptance suite under `packages/rag-core/test/acceptance/`. Separate `vitest.acceptance.config.ts` sets a 6-minute test timeout, `forks` pool (for subprocess isolation), and verbose reporter. Fixture helpers (`writeChunks`, `writeEmbeddings`, `writeTelemetry`, `writeExperimentRun`) allow most tests to skip the full pipeline. `E2E_CLONE_DIR` environment variable bypasses the slow `git clone` step so developers can iterate quickly. One test per CLI command.

## Consequences

- **+** Per-test failure isolation; JUnit-compatible output for CI.
- **+** Typed JSON assertions instead of stdout grep.
- **+** Fixture-based tests run in seconds; only `update` and `store` require the full pipeline.
- **−** First run takes ~10 minutes (clone + embed); `E2E_CLONE_DIR` required for fast iteration.

## Alternatives Considered

[Not documented in original]

## References

[Not documented in original]
