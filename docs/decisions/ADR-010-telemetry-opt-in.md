---
id: ADR-010
title: Telemetry as an opt-in pipeline concern
status: Accepted
date: 2026-05-31
related: [ADR-002]
---

## Context

Understanding pipeline performance (per-stage duration, chunk counts, embedding latency) is useful for tuning but irrelevant to most runs. Baking telemetry into every stage would clutter the core logic.

## Decision

`TelemetryCollector` is instantiated only when `options.telemetry: true`. The `Orchestrator` holds a nullable reference (`telemetry?.recordX()`). On completion, telemetry prints a summary and saves to `telemetry.json` alongside `chunks.json`. Webhook notifications are a separate opt-in (`options.notifications.webhookUrl`).

## Consequences

- **+** Zero overhead when telemetry is off (the default).
- **+** Webhook notifications decouple alerting from the telemetry data model.
- **−** Telemetry data is local-file-only; no remote sink is built in.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-002](./ADR-002-four-stage-pipeline.md) — four-stage pipeline design that enables per-stage telemetry
