---
id: ADR-029
title: No switch to Claude Code native subagents for Virage skills
status: Accepted
date: 2026-06-15
related: [ADR-025, ADR-026, ADR-027]
---

## Context

Virage skills are delivered as static `.md` files copied into vendor-specific config directories by `BaseAgentPlugin.configure()`. The question arose whether to replace or augment this model with Claude Code's native `Agent` tool (subagent dispatch) for deterministic skills like `code-guardian` or `qa`, to gain isolated context windows, parallel execution, and typed return values.

## Decision

**Do not switch to Claude Code native subagents.** Keep the static `.md` skill model for all four supported agents.

Reasons:

1. **Vendor parity (ADR-026).** Copilot, Codex, and Antigravity have no equivalent of Claude Code's `Agent` tool. Adding Claude-only subagent dispatch paths creates a permanently diverging codebase: three of four vendors would receive a degraded experience, and any skill that uses subagent dispatch becomes Claude Code-only.

2. **Human-in-loop continuity.** Skills like `planner` and `architect` require iterative back-and-forth with the user (plan approval, ADR review). Subagents start cold, return opaque results, and break the single-thread conversational flow that makes these skills effective.

3. **The MCP layer is the right abstraction boundary.** ADR-027's `suggest_skill` + `list_skills` already give single-round-trip routing. Adding a `run_skill` MCP tool that spawns a subagent internally would couple the MCP server to the Claude API, break vendor parity at the MCP level, and add billing complexity.

4. **Revisit condition.** If Copilot agent mode, Codex, or Antigravity gain a vendor-neutral subagent dispatch API at the same abstraction level, reassess.

## Consequences

- **+** All four agent vendors continue to receive the same skill content.
- **+** No new dependencies on the Claude API within the Virage packages.
- **+** Skills remain auditable static files, not opaque agent invocations.
- **−** Deterministic skills (`code-guardian`, `qa`) execute inline in the parent session, adding their tool calls to the main context window.
- **−** No parallel skill execution without vendor-specific workarounds.

## Alternatives Considered

Claude Code native `Agent` tool for deterministic skills was evaluated and rejected for the reasons documented in the Decision section above.

## References

- [ADR-025](./ADR-025-universal-agent-hook-base.md) — agent plugin architecture this decision preserves
- [ADR-026](./ADR-026-static-file-copier-agent-plugins.md) — static file model kept as-is
- [ADR-027](./ADR-027-list-skills-skillmeta-response.md) — MCP routing layer that makes subagents unnecessary
