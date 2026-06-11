# @vivantel/virage-agent-copilot

GitHub Copilot agent plugin for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## What it does

`virage init` calls this plugin's `configure()` to write Copilot hook configuration from `@vivantel/virage-skills` into `.github/copilot/hooks.json`.

Hooks are translated from the virage-skills format (Claude-style matchers) to Copilot's flat event-keyed array format. Existing entries are not duplicated on repeated calls.

## Supported events (12)

`session_start`, `session_end`, `user_prompt_submit`, `pre_tool_use`, `post_tool_use`, `post_tool_use_failure`, `permission_request`, `subagent_start`, `subagent_stop`, `agent_stop`, `error_occurred`, `pre_compact`

## Config file written

```
<project>/.github/copilot/hooks.json
```

```json
{
  "version": "1.0",
  "hooks": {
    "PreToolUse": [
      { "type": "command", "command": "echo '...'", "statusMessage": "..." }
    ],
    "PostToolUse": []
  }
}
```

## Installation

```bash
npm install @vivantel/virage-agent-copilot
```

## Usage

### Via `virage init`

```bash
npx @vivantel/virage-cli init
```

Select "GitHub Copilot" when prompted to choose coding agents.

### Programmatic

```typescript
import { configure } from "@vivantel/virage-agent-copilot";

await configure("/path/to/project");
```
