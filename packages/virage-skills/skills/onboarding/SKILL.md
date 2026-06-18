---
name: onboarding
description: Self-orientation command for AI agent. When invoked with "onboard", the agent discovers all skills via MCP, then configures the environment based on setup instructions they contain.
license: MIT
when_to_use:
  - "Starting a new session in a Virage project for the first time"
  - "Re-orienting after a long gap or project restructure"
  - "Running virage init or virage update in a new repo"
  - "Configuring Claude Code hooks and MCP server for a new project"
prerequisites: []
estimated_tokens: 500
output_format: "Environment configured; summary of skills loaded and setup actions applied"
metadata:
  author: vivantel-team
  version: "2.0.0"
---

# Skill: Onboarding

**Purpose:** When user says "onboard", the agent discovers all skills via MCP tools and applies any setup instructions they contain.

---

## Role

**Developer Experience Lead** — ensures any agent (or human) can become productive in this project from a cold start.

Responsibilities:
- Validate the environment before work begins, not just collect configuration
- Identify friction: missing hooks, unresponsive MCP server, or missing setup steps are blockers — not warnings
- Surface setup gaps to the user rather than silently skipping them
- Ensure the session is correctly oriented with all conventions loaded before any task starts
- Treat onboarding as the quality gate for agent productivity — incomplete onboarding leads to incorrect behavior

---

## When to use this skill

- User says "onboard"
- Agent first enters the repository
- User says "refresh my environment"

---

## Instructions

When user says "onboard":

### 1. Discover available skills

Use MCP tools in order of increasing cost:

1. `mcp__virage__list_skills()` — returns all skill names, `when_to_use` triggers, and `estimated_tokens`. Total cost: ~500 tokens for all 12 skills.
2. For each skill whose `when_to_use` triggers include setup-relevant verbs (configure, create, install, remember, run, set): call `mcp__virage__read_skill_summary('<name>')` to read the ≤20-line summary (~150 tokens each).
3. Call `mcp__virage__read_skill('<name>')` only for skills whose summary confirms actionable setup instructions.

**Always load fully on first onboard:**
- `code-guard` — defines commit protocol and quality gate rules to remember
- `planner` — defines the ADR gate rule and plan format to remember
- `skill-writer` — defines the skill standard; needed before any skill modification

**Fallback (MCP unavailable):** Read `**/SKILL.summary.md` files from `.agents/skills/virage/*/` using Read tool. Load full `SKILL.md` only when the summary indicates setup actions (contains verbs: configure, create, install, remember, set).

### 2. Apply setup instructions

An instruction is **actionable** if it contains one of these verbs applied to a concrete artifact: *configure, create, install, remember, run, set*. Skip descriptive sentences.

Examples of what to look for:
- Hook configurations (git hooks, agent `PreToolUse` hooks, etc.)
- Environment variables to set or remember
- Directories to create
- Commands or rules to remember (commit format, ADR gate, etc.)
- File paths to note as important

### 3. Validate the environment

Before declaring onboarding complete, verify that the setup is functional — not just that configuration was found:

- Confirm MCP server is responsive: `mcp__virage__list_skills()` returned results without error
- Confirm any required hooks are installed (e.g., pre-commit quality gate hook)
- Confirm any required environment variables are set or noted

**If any setup step fails or is missing, do not proceed to the user's task. Surface the gap first** — a session with broken tooling will produce incorrect results regardless of how well the agent understands the conventions.

### 4. Report

Tell the user what you configured, what you remembered, and any setup gaps found.

---

## Example

**User:** "onboard"

**Agent uses MCP tools and finds:**

- `mcp__virage__list_skills()` returns 12 skills
- Summaries reveal `code-guard` and `planner` have setup-relevant content
- Full read of `code-guard` → remembers commit protocol and quality gate rule
- Full read of `planner` → remembers ADR gate rule and plan file path
- Full read of `skill-writer` → remembers skill format standard

**Agent responds:**

```
Onboarding complete.

Remembered:
  - ADR gate rule (write ADR before structural changes)
  - Commit protocol (run quality gate before staging)
  - Plan file location
  - Skill format standard (skill-writer)
  - @spec-writer sync convention

Skills available: analyst, architect, code-guard, devops, doc-writer,
  onboarding, overseer, package, planner, qa, skill-writer, spec-writer
```

## Output Format

Summary of onboarding results:

```
Onboarding complete.

Configured: <list of environment changes made>
Remembered: <list of rules/conventions loaded>
Skills available: <alphabetical list of discovered skills>
```

Done when: all setup-critical skills have been read, their actionable instructions applied or remembered, and the environment validated as functional. If any validation step failed, that gap is surfaced to the user before any other task proceeds.
