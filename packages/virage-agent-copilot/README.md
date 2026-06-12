# @vivantel/virage-agent-copilot

GitHub Copilot agent plugin for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## What it does

`virage init` calls this plugin's `configure()` to copy static files from `plugin-config/` into `.github/copilot/` — including `hooks.json` and the `/virage-plan` custom instruction.

## `/virage-plan` custom instruction

After `virage init` (or `configure()`), the `virage-plan` instruction is available in Copilot. It loads the Virage planner skill and breaks down the given request into a structured implementation plan.

## Supported events (12)

`session_start`, `session_end`, `user_prompt_submit`, `pre_tool_use`, `post_tool_use`, `post_tool_use_failure`, `permission_request`, `subagent_start`, `subagent_stop`, `agent_stop`, `error_occurred`, `pre_compact`

## Config files written

```
<project>/.github/copilot/hooks.json
<project>/.github/copilot/instructions/virage-plan.md
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
