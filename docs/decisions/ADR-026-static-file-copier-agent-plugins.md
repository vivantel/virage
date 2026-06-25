---
id: ADR-026
title: Static-file copier model for agent plugins
status: Accepted
date: 2026-06-12
related: [ADR-025]
---

## Context

After ADR-025 introduced `BaseAgentPlugin`, each vendor plugin still contained imperative `configure()` logic to: (1) read the normalized `hooks.json` from `@vivantel/virage-skills`, (2) translate it to vendor-specific format, and (3) write/merge the result into vendor config files. The translation logic was duplicated across `config.ts` files in each plugin package.

Additionally, the `/plan` slash command was absent from all agent integrations. There was no standard way to add vendor-specific command files without extending the translation pipeline further.

## Decision

1. **Plugins ship static `plugin-config/` directories.** Each vendor plugin package contains a `plugin-config/` folder with pre-authored, vendor-native config files (hook configs, command files, etc.). These are maintained manually in sync with `virage-skills/agent-config/hooks.json`.

2. **`BaseAgentPlugin.configure()` is now concrete.** It resolves the plugin package root via `createRequire(import.meta.url).resolve(vendorConfig.packageName + '/package.json')`, then recursively copies `plugin-config/` to `targetDir/vendorConfig.projectConfigDir`. Files are only written when content changes (content-equality check before overwrite).

3. **`VendorConfig` gains three fields:** `packageName`, `pluginConfigDir` (always `"plugin-config"`), and `projectConfigDir` (e.g. `".claude"`, `".github/copilot"`, `".codex"`, `".antigravity"`).

4. **`/plan` slash command.** Claude plugin ships `plugin-config/commands/plan.md` → written to `.claude/commands/plan.md`. Copilot ships `plugin-config/instructions/virage-plan.md`.

5. **Claude plugin retains one override.** `ClaudeAgentPlugin.configure()` calls `super.configure()` (for static file copy) then calls `mergeMcpServer()`, which registers the MCP server via `claude mcp add`. MCP registration is Claude-specific and cannot be expressed as a static file.

6. **`config.ts` translation files removed** from `virage-agent-copilot`, `virage-agent-codex`, and `virage-agent-antigravity`.

7. **`virage update` command added.** Discovers `@vivantel/*` and `rag-plugin`/`virage-agent` packages, shows current vs. latest versions, and runs `pm install pkg@latest` for selected packages.

## Consequences

- **+** Vendor plugins are thin: ~15 lines of TypeScript each for copilot/codex/antigravity, no imperative hook translation.
- **+** Static files are diff-friendly, auditable, and version-controlled alongside the plugin package.
- **+** `/plan` command available in Claude Code after `virage init`.
- **+** `virage update` provides one-command ecosystem maintenance.
- **−** Static hook files must be manually updated when `virage-skills/agent-config/hooks.json` changes.
- **−** `VendorConfig` now embeds `packageName`, coupling the constant to the published package name.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-025](./ADR-025-universal-agent-hook-base.md) — base package this model builds on
