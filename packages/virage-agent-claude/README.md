# @vivantel/virage-agent-claude

Claude Code agent plugin for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## What it does

- **Init-time**: `virage init` calls this plugin's `configure()` to copy static files from `plugin-config/` into `.claude/` (commands, skills, etc.) and register the Virage MCP server in `.mcp.json`
- **Runtime MCP server**: An MCP stdio server the agent can connect to in order to read skills on demand and self-configure new projects

## `/virage-plan` slash command

After `virage init` (or `configure()`), the `/virage-plan` command is available in Claude Code. It loads the Virage planner skill from `.agents/skills/virage/planner/SKILL.md` and breaks down the given request into a structured implementation plan.

## MCP tools

| Tool | Description |
|------|-------------|
| `list_skills` | Returns all available Virage skill names |
| `read_skill(name)` | Returns the SKILL.md content for the named skill |
| `onboard(targetDir?)` | Copies plugin-config/ files and registers this MCP server in the project |

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
    "virage-agent": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@vivantel/virage-agent-claude"]
    }
  }
}
```
