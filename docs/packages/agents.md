# Agent Plugins

Agent plugins configure AI coding assistants to use Virage skills, hooks, and MCP tools. Each plugin targets one IDE/agent.

## Quick reference

| Package | Agent | Hook type |
|---|---|---|
| `@vivantel/virage-agent-claude` | Claude Code | Settings JSON + MCP server |
| `@vivantel/virage-agent-codex` | OpenAI Codex | `codex.yaml` hooks |
| `@vivantel/virage-agent-copilot` | GitHub Copilot | `.github/copilot` hooks |
| `@vivantel/virage-agent-antigravity` | Google Antigravity | `.antigravity` hooks |

---

## How agent plugins work

Agent plugins are selected during `virage init`. After selection, `virage init` calls the plugin's `configure()` method which:
1. Writes agent-specific config files (`.claude/`, `codex.yaml`, etc.) into the project root
2. Registers the plugin's MCP server (if applicable)
3. Copies virage skill files

To re-apply config after updating the plugin package, run `virage update`.

---

## `@vivantel/virage-agent-core`

Shared base — abstract class and shared type definitions used by all agent plugins. Not installed directly; each vendor plugin depends on it.

**Hook events (universal model):**

| Event | Trigger |
|---|---|
| `file:change` | A tracked file is modified |
| `commit:pre` | Before a git commit |
| `session:start` | Agent session opens |
| `session:end` | Agent session closes |

---

## `@vivantel/virage-agent-claude`

Configures Claude Code with Virage skills, hooks, and an MCP server.

**What it installs:**

- `.claude/skills/virage/` — skill markdown files
- `.claude/settings.json` — hook configuration
- `.mcp.json` — registers `virage` MCP server

**Slash commands (available in Claude Code after init):**

| Command | Description |
|---|---|
| `/plan` | Loads Virage planner skill; breaks request into implementation plan |
| `/usage` | Shows per-prompt token usage for the current session |

**MCP tools:**

| Tool | Description |
|---|---|
| `list_skills` | Returns all available Virage skill names |
| `read_skill(name)` | Returns the SKILL.md for the named skill |
| `onboard(targetDir?)` | Copies plugin-config/ and registers MCP server |
| `session_usage` | Returns per-prompt token usage table |

**MCP server registration (manual):**

```json
{
  "mcpServers": {
    "virage": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@vivantel/virage-agent-claude@latest"]
    }
  }
}
```

---

## `@vivantel/virage-agent-codex`

Configures OpenAI Codex with Virage hooks via `codex.yaml`.

**What it installs:**

- `.codex/` — agent config directory with Virage hook definitions
- Hooks for `file:change`, `commit:pre`, `session:start`

---

## `@vivantel/virage-agent-copilot`

Configures GitHub Copilot with Virage hooks via `.github/copilot/`.

**What it installs:**

- `.github/copilot/` — Copilot instructions and hook config

---

## `@vivantel/virage-agent-antigravity`

Configures Google Antigravity with Virage hooks via `.antigravity/`.

**What it installs:**

- `.antigravity/` — Antigravity config directory with Virage hook definitions
