# @vivantel/virage-agent-claude

Claude Code agent plugin for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## What it does

- **Init-time**: `virage init` calls this plugin's `configure()` to copy static files from `plugin-config/` into `.claude/` (commands, skills, etc.) and register the Virage MCP server in `.mcp.json`
- **Runtime MCP server**: An MCP stdio server the agent can connect to in order to read skills on demand and self-configure new projects

## Slash commands

After `virage init` (or `configure()`), two commands are available in Claude Code:

| Command | Description |
|---------|-------------|
| `/plan` | Loads the Virage planner skill and breaks down the request into a structured implementation plan |
| `/usage` | Shows a per-prompt token usage breakdown for the current session |

## MCP tools

| Tool | Description |
|------|-------------|
| `list_skills` | Returns all available Virage skill names |
| `read_skill(name)` | Returns the SKILL.md content for the named skill |
| `onboard(targetDir?)` | Copies plugin-config/ files and registers this MCP server in the project |
| `session_usage` | Returns a per-prompt token usage table for the current session |

## Usage

### Via `virage init`

```bash
npx @vivantel/virage-cli init
```

Select the Claude Code agent plugin when prompted.

### MCP server registration

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "virage": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@vivantel/virage-agent-claude"]
    }
  }
}
```

### Keeping up to date

After updating the npm package or the vivantel marketplace plugin, re-sync the installed command files by running:

```bash
npx @vivantel/virage-cli update
```

This automatically re-runs `configure()` to copy any new or changed files from `plugin-config/` into `.claude/skills/virage/`. Then run `/reload-plugins` in Claude Code to pick up the changes.
