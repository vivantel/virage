# @vivantel/virage-agent-codex

OpenAI Codex agent plugin for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## What it does

`virage init` calls this plugin's `configure()` to write Codex hook configuration from `@vivantel/virage-skills` into `.codex/hooks.json`.

Hooks are translated from the virage-skills format to Codex's command-only format (no matcher field, PascalCase event keys). Existing entries are not duplicated on repeated calls.

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
