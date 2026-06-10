# @vivantel/virage-agent-claude

Claude Code agent plugin for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## What it does

- **Init-time**: `virage init` calls this plugin's `configure()` to write Claude Code hooks and register the MCP server
- **Runtime MCP server**: An MCP stdio server the agent can connect to in order to read skills on demand and self-configure new projects

## MCP tools

| Tool | Description |
|------|-------------|
| `list_skills` | Returns all available Virage skill names |
| `read_skill(name)` | Returns the SKILL.md content for the named skill |
| `onboard(targetDir?)` | Writes Claude Code hooks and registers this MCP server in the project |

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
