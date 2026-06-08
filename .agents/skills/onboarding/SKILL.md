---
name: onboarding
description: Self-orientation command for AI agent. When invoked with "onboard", the agent reads all skills, then configures the environment based on their rules.
license: MIT
metadata:
  author: vivantel-team
  version: "1.0.0"
---

# Skill: Onboarding

**Purpose:** When user says "onboard", the agent reads all skills and applies any setup instructions they contain.

---

## When to use this skill

- User says "onboard"
- Agent first enters the repository
- User says "refresh my environment"

---

## Instructions

When user says "onboard":

### 1. Read all skills

Read every `SKILL.md` in `.agents/skills/` and all subdirectories.

### 2. Apply setup instructions

While reading each skill, look for any **actionable setup instructions** — things the skill says the agent should configure, install, or remember.

Examples of what to look for (but skills may contain others):

- Hook configurations (git hooks, Claude `PreToolUse`, etc.)
- Environment variables to set
- Directories to create
- Commands to remember as triggers
- File paths to note as important
- Rules to follow (commit format, ADR gate, etc.)

Use your judgment: if a skill says "do X" or "configure Y", do it.

### 3. Report

Tell the user what you configured and what you remembered.

---

## Example

**User:** "onboard"

**Agent reads skills and finds:**

- `code-guardian/SKILL.md` contains a bash code block — creates `.git/hooks/pre-commit` with that content
- `code-guardian/SKILL.md` mentions `PreToolUse` hook in `.claude/settings.json` — ensures it's configured
- `planner/SKILL.md` says "write ADR before implementing" — remembers the gate rule
- `spec-cop/SKILL.md` mentions `@spec-cop validate` — remembers the command
- `package/SKILL.md` lists required `package.json` fields — remembers them

**Agent responds:**

```
Onboarding complete.

Configured:
  - .git/hooks/pre-commit
  - .claude/settings.json (PreToolUse)

Remembered:
  - ADR gate rule
  - @spec-cop validate command
  - Package.json required fields
  - Artifact paths (.virage/, .agents/specs/, docs/ADR.md)
```
