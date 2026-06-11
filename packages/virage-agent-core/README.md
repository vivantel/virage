# @vivantel/virage-agent-core

Shared base package for [Virage](https://github.com/vivantel/virage) agent plugins. Provides TypeScript types and the abstract `BaseAgentPlugin` class that all agent integrations extend.

## What it provides

- **`NormalizedEventName`** — union type of all 33 vendor-agnostic hook event names
- **`VendorConfig`** — interface + four constants encoding the full event→vendor name mapping for Claude Code, GitHub Copilot, OpenAI Codex, and Google Antigravity
- **`BaseAgentPlugin`** — abstract class with `supportsEvent()`, `getVendorEventName()`, `getPrimaryEventName()`, and abstract `configure()` method
- **Common I/O types** — `AgentHookInput`, `AgentHookOutput`, `PreToolUseInput/Output`, `AgentStopInput/Output`, `UserPromptSubmitInput/Output`
- **`AgentConfigResult`** — the return type of every plugin's `configure()` function

## Installation

```bash
npm install @vivantel/virage-agent-core
```

## Usage

```typescript
import {
  BaseAgentPlugin,
  CLAUDE_VENDOR_CONFIG,
  type AgentConfigResult,
} from "@vivantel/virage-agent-core";

export class MyAgentPlugin extends BaseAgentPlugin {
  readonly name = "my-agent";
  readonly label = "My Agent";
  readonly vendorConfig = CLAUDE_VENDOR_CONFIG; // or your own VendorConfig

  async configure(targetDir: string): Promise<AgentConfigResult> {
    // write vendor-specific hook config files
    return { hooksWritten: true };
  }
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

- `@vivantel/virage-agent-claude` — Claude Code (`.claude/settings.json` + `.mcp.json`)
- `@vivantel/virage-agent-copilot` — GitHub Copilot (`.github/copilot/hooks.json`)
- `@vivantel/virage-agent-codex` — OpenAI Codex (`.codex/hooks.json`)
- `@vivantel/virage-agent-antigravity` — Google Antigravity (`.antigravity/hooks.json`)
