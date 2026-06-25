---
id: ADR-025
title: Universal agent hook base package (virage-agent-core)
status: Accepted
date: 2026-06-11
related: [ADR-026]
---

## Context

`virage-agent-claude` was a standalone package with no shared contract for agent hook configuration. Adding support for additional coding agents (GitHub Copilot, OpenAI Codex, Google Antigravity) would require duplicating type definitions and boilerplate in each package, with no guarantee of consistency.

The YAML-based Universal Agent Hook Event Model defines 33 normalized event names and vendor-specific mappings for all 4 supported agents. This schema needed a canonical TypeScript representation.

The `virage-cli` init wizard Step 2 hardcoded `{ name: "Claude", value: "claude" }`, preventing dynamic discovery of newly installed agent plugins.

## Decision

1. **`@vivantel/virage-agent-core`** — new shared package with:
   - `NormalizedEventName` union type (33 events)
   - `VendorConfig` interface and four constants encoding the full event→vendor name mapping
   - `BaseAgentPlugin` abstract class with `supportsEvent()`, `getVendorEventName()`, `getPrimaryEventName()`, and abstract `configure()` method
   - Common I/O types: `AgentHookInput`, `AgentHookOutput`, `PreToolUseInput/Output`, `AgentStopInput/Output`, etc.

2. **All four agent packages extend `BaseAgentPlugin`**: `virage-agent-claude` (refactored to 0.2.0), plus three new packages `virage-agent-copilot`, `virage-agent-codex`, `virage-agent-antigravity`. Each implements `configure(targetDir)` to write vendor-specific hook config files.

3. **virage-cli init wizard** Step 2 calls `discoverAgentPlugins()` before the loop and builds choices dynamically from installed plugins, falling back to a hardcoded Claude Code entry if none are found.

## Consequences

- **+** New agent vendors can be added as separate npm packages without touching `virage-cli`.
- **+** Consistent TypeScript types across all agent integrations.
- **+** Init wizard automatically shows newly installed agent plugins.
- **−** `virage-agent-claude` version bumped to 0.2.0; existing users must update.
- **−** `virage-agent-core` is a new required peer for all agent packages.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-026](./ADR-026-static-file-copier-agent-plugins.md) — static-file plugin model built on top of this base
