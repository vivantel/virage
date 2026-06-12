# @vivantel/virage-agent-core

Shared base package for [Virage](https://github.com/vivantel/virage) agent plugins. Provides TypeScript types and the concrete `BaseAgentPlugin` class that all agent integrations extend.

## What it provides

- **`NormalizedEventName`** — union type of all 33 vendor-agnostic hook event names
- **`VendorConfig`** — interface + four constants encoding vendor event mappings, `packageName`, `pluginConfigDir`, and `projectConfigDir` for all 4 vendors
- **`BaseAgentPlugin`** — concrete class with `supportsEvent()`, `getVendorEventName()`, `getPrimaryEventName()`, and a default `configure()` that recursively copies the plugin's `plugin-config/` directory to `projectConfigDir` (content-compared, idempotent). Subclasses override `configure()` only for vendor-specific extras (e.g. MCP registration).
- **Common I/O types** — `AgentHookInput`, `AgentHookOutput`, `PreToolUseInput/Output`, `AgentStopInput/Output`, `UserPromptSubmitInput/Output`
- **`AgentConfigResult`** — the return type of every plugin's `configure()` function

## Installation

```bash
npm install @vivantel/virage-agent-core
```

## Usage

For a plugin that only needs static files, no `configure()` override is required:

```typescript
import {
  BaseAgentPlugin,
  type VendorConfig,
} from "@vivantel/virage-agent-core";

const MY_VENDOR_CONFIG: VendorConfig = {
  vendor: "my-agent",
  packageName: "@myorg/virage-agent-my-agent",
  pluginConfigDir: "plugin-config",
  projectConfigDir: ".my-agent",
  // ...event mappings
};

export class MyAgentPlugin extends BaseAgentPlugin {
  readonly name = "my-agent";
  readonly label = "My Agent";
  readonly vendorConfig = MY_VENDOR_CONFIG;
  // configure() inherited: copies plugin-config/ → .my-agent/ in target project
}

const plugin = new MyAgentPlugin();
plugin.supportsEvent("pre_tool_use"); // → true
plugin.getPrimaryEventName("agent_stop"); // → "Stop"
```

## Supported vendor configs

| Constant | Vendor | Events |
|----------|--------|--------|
| `CLAUDE_VENDOR_CONFIG` | Claude Code | 30 |
| `COPILOT_VENDOR_CONFIG` | GitHub Copilot | 12 |
| `CODEX_VENDOR_CONFIG` | OpenAI Codex | 10 |
| `ANTIGRAVITY_VENDOR_CONFIG` | Google Antigravity | 5 |

## Built-in agent packages

- `@vivantel/virage-agent-claude` — Claude Code (`.claude/` commands + skills, `.mcp.json`)
- `@vivantel/virage-agent-copilot` — GitHub Copilot (`.github/copilot/` hooks + instructions)
- `@vivantel/virage-agent-codex` — OpenAI Codex (`.codex/hooks.json`)
- `@vivantel/virage-agent-antigravity` — Google Antigravity (`.antigravity/hooks.json`)
