---
name: doc_writer
description: "Doc Writer — update README.md to reflect codebase changes. User-facing only — no internal details."
license: MIT
metadata:
  author: vivantel-team
  version: "1.0.0"
---

# Skill: Doc Writer

**Purpose:** Update `README.md` to reflect codebase changes. User-facing only — no internal details.

---

## When to use this skill

- After any change that affects user-visible features or CLI commands
- When a new package, strategy, or integration is added or removed
- When the README is visibly out of sync with the current codebase
- After updating the Quick Start, config format, or CLI flags

---

## Context checklist

```
[ ] Read current README.md
[ ] Run: git log --oneline -20   (identify recent unreflected changes)
[ ] Identify which sections need updating (use section map below)
[ ] Before committing: npm run fix && npm run lint && npm run type-check:ci (see .agents/skills/code-guardian/SKILL.md)
```

---

## Current State — README section map

| Section               | Update trigger                                    |
| --------------------- | ------------------------------------------------- |
| Badges (npm, node)    | Version bump or Node requirement change           |
| Package list          | New package added or removed                      |
| Quick start           | CLI default flags changed, new required step      |
| Config format         | New top-level field or env var expansion behavior |
| Built-in strategies   | New strategy added to virage-strategies           |
| CLI flags/subcommands | New subcommand or flag added or removed           |
| Plugin system         | Plugin registration interface changed             |
| Embedders             | New embedder package added or removed             |
| Vector stores         | New store package added or removed                |
| Tuning                | New pipeline option added to `options` block      |
| MCP integration       | virage-mcp tool list or setup steps change        |
| Dashboard             | Dashboard feature or launch command changes       |
| Contributing          | Link target or CONTRIBUTING.md structure changes  |

> **Keep this table current.** After adding a new README section, add a row here.

---

## Rules

- README is user-facing only — no internal architecture, pipeline stage names, or implementation details
- Code snippets must be copy-paste valid; test against actual `virage --help` output if in doubt
- Badge URLs follow the existing pattern — verify format before adding new ones
- Keep Quick Start under ~20 lines; link to docs for depth
- Package list must match the `packages/` directory — cross-check with `.agents/skills/package/SKILL.md` inventory

---

## Update checklist

```
[ ] Use section map above to identify changed sections
[ ] Verify all CLI examples match current virage --help output
[ ] Verify all package names match packages/ directory
[ ] Verify config example includes no removed or renamed fields
[ ] Run: npm run fix && npm run lint && npm run type-check:ci (hook also fires on commit via Claude Code)
```

---

## After updating

Run `.agents/skills/overseer/SKILL.md` reactive checklist if any section was added or removed.
