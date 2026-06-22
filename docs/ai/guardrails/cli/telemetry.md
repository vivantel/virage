# Guardrail: CLI Telemetry

## Rule

CLI commands that represent meaningful user actions (index, check, validate, query, eval) **must** record a telemetry event after execution, gated on `telemetry.enabled && tiers.implicit`.

## Gate

```typescript
// telemetry is only sent when BOTH are true:
config.telemetry.enabled === true
config.telemetry.tiers.implicit === true
```

Never send telemetry when `enabled` is false or `tiers.implicit` is false.  
Never use the `explicit_feedback` tier for CLI events — that tier is for MCP rag_feedback tool calls only.

## How to emit a CLI event

```typescript
import { CliTelemetry } from "../cli-telemetry.js";

const tel = await CliTelemetry.fromConfigPath(opts.config);
const t0 = Date.now();
let success = false;
try {
  await runTheOperation();
  success = true;
} finally {
  tel.record("check", Date.now() - t0, success);
}
```

`CliTelemetry.record()` is a no-op when the gate is not met, so the `try/finally` pattern is safe even if telemetry is off.

## What to record per event

| Field | Type | Notes |
|-------|------|-------|
| `command` | string | CLI command name (`"check"`, `"validate"`, `"index"`, etc.) |
| `durationMs` | number | Wall-clock ms from start to completion |
| `success` | boolean | `false` on any thrown error |

Do **not** record: file paths, query content, user-identifiable data. The privacy settings in `TelemetryConfig.privacy` apply; respect `file_path_anonymization`.

## Loading telemetry config

Always load from the command's `--config` path if available.  
If no config path is present (e.g., `virage telemetry status`), skip telemetry silently.  
Never crash a command because telemetry failed to load — wrap in `try/catch`.

## Where telemetry events go

CLI events are stored in the telemetry SQLite (separate from `virage.db`) and flushed to the configured endpoint by `TelemetryFlusher` on the same schedule as MCP search events (configurable via `aggregation_window_minutes`).

## Do NOT emit telemetry from

- `virage telemetry *` subcommands (telemetry management itself is not instrumented)
- `virage init` (no config to read yet)
- Internal helpers / non-command code
