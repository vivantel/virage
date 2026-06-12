# @vivantel/virage-agent-codex

OpenAI Codex agent plugin for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## What it does

`virage init` calls this plugin's `configure()` to copy static files from `plugin-config/` into `.codex/` — including `hooks.json` in Codex's native format.

## Supported events (10)

`session_start`, `user_prompt_submit`, `pre_tool_use`, `post_tool_use`, `permission_request`, `subagent_start`, `subagent_stop`, `agent_stop`, `pre_compact`, `post_compact`

## Config file written

```
<project>/.codex/hooks.json
```

```json
{
  "hooks": {
    "PreToolUse": [
      { "type": "command", "command": "echo '...'" }
    ],
    "PostToolUse": []
  }
}
```

## Installation

```bash
npm install @vivantel/virage-agent-codex
```

## Usage

### Via `virage init`

```bash
npx @vivantel/virage-cli init
```

Select "OpenAI Codex" when prompted to choose coding agents.

### Programmatic

```typescript
import { configure } from "@vivantel/virage-agent-codex";

await configure("/path/to/project");
```
