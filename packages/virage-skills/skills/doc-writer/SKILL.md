---
name: doc-writer
description: "Doc Writer — update README.md to reflect codebase changes. User-facing only — no internal details."
license: MIT
when_to_use:
  - "Writing or updating README.md after a feature change"
  - "Adding or revising CHANGELOG entries"
  - "Writing user-facing documentation for a new CLI flag or config field"
  - "Reviewing docs for accuracy after a refactor"
prerequisites: []
estimated_tokens: 700
output_format: "Updated README.md section or CHANGELOG entry, user-facing prose only"
metadata:
  author: vivantel-team
  version: "2.0.0"
---

# Skill: Doc Writer

**Purpose:** Update `README.md` to reflect codebase changes. User-facing only — no internal details.

---

## Role

**Lead Technical Writer (user-facing)** — owns user-facing documentation as a product.

Responsibilities:
- Treat documentation as a deliverable with its own quality bar — not an afterthought
- Track documentation coverage: every user-visible feature, CLI flag, and config option must be documented before it can be considered shipped
- Maintain consistency of voice, format, and example quality across all documentation
- Review PRs from a documentation perspective: does this change introduce undocumented behavior?
- Identify pre-existing documentation gaps, not just changes since the last commit
- Keep documentation accurate and copy-paste valid — stale examples erode user trust

---

## When to use this skill

- After any change that affects user-visible features or CLI commands
- When a new package, strategy, or integration is added or removed
- When the README is visibly out of sync with the current codebase
- After updating the Quick Start, config format, or CLI flags

---

## Context checklist

1. Read current `README.md`
2. Run: `git log --oneline -20` (identify recent unreflected changes)
3. Identify which sections need updating (use section map below)

```
[ ] Run pre-commit quality checks before staging (see code-guard skill)
```

---

## Current State — README section map

| Section               | Update trigger                                    |
| --------------------- | ------------------------------------------------- |
| Badges (npm, node)    | Version bump or Node requirement change           |
| Package list          | New package added or removed                      |
| Quick start           | CLI default flags changed, new required step      |
| Config format         | New top-level field or env var expansion behavior |
| Built-in strategies   | New built-in strategy or plugin added             |
| CLI flags/subcommands | New subcommand or flag added or removed           |
| Plugin system         | Plugin registration interface changed             |
| Embedders             | New embedder package added or removed             |
| Vector stores         | New store package added or removed                |
| Tuning                | New pipeline option added to `options` block      |
| MCP integration       | MCP tool list or setup steps change               |
| Dashboard             | Dashboard feature or launch command changes       |
| Contributing          | Link target or CONTRIBUTING.md structure changes  |

> **Keep this table current.** After adding a new README section, add a row here.

---

## Rules

- README is user-facing only — no internal architecture, pipeline stage names, or implementation details
- Code snippets must be copy-paste valid; test against actual `virage --help` output if in doubt
- Badge URLs follow the existing pattern — verify format before adding new ones
- Keep Quick Start under ~20 lines; link to docs for depth
- Package list must match the `packages/` directory — cross-check with `package` skill inventory
- **Documentation is part of the definition of done**: a feature that ships without documentation is not done. Block merge until docs are updated.

---

## Update checklist

```
[ ] Use section map above to identify changed sections
[ ] Check for pre-existing gaps: are there any features or options in the code that have no documentation? (Go beyond the current change.)
[ ] Verify all CLI examples match current virage --help output
[ ] Verify all package names match packages/ directory
[ ] Verify config example includes no removed or renamed fields
[ ] Run pre-commit quality checks (see code-guard skill)
```

---

## After updating

Run `overseer` skill reactive checklist if any section was added or removed.

## Output Format

Updated README.md section(s) or CHANGELOG entry. User-facing prose only.

Done when: all sections identified by the section map as affected by recent changes have been reviewed and updated. No internal implementation details in any updated section.
