# @vivantel/virage-agent-antigravity

Google Antigravity agent plugin for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## What it does

`virage init` calls this plugin's `configure()` to write Antigravity hook configuration from `@vivantel/virage-skills` into `.antigravity/hooks.json`.

Hooks are translated from the virage-skills format with `terminationBehavior: "continue"` added to each entry (Antigravity's recommended default). Existing entries are not duplicated on repeated calls.

## Supported events (5)

`pre_tool_use`, `post_tool_use`, `agent_stop`, `pre_invocation`, `post_invocation`

## Config file written

```
<project>/.antigravity/hooks.json
```

```json
{
  "hooks": {
    "PreToolUse": [
      { "type": "command", "command": "echo '...'", "terminationBehavior": "continue" }
    ],
    "PostToolUse": []
  }
}
```

## Installation

```bash
npm install @vivantel/virage-agent-antigravity
```

## Usage

### Via `virage init`

```bash
npx @vivantel/virage-cli init
```

Select "Google Antigravity" when prompted to choose coding agents.

### Programmatic

```typescript
import { configure } from "@vivantel/virage-agent-antigravity";

await configure("/path/to/project");
```
