# Skill: Maintain Root README.md

**Purpose:** Update `README.md` to reflect codebase changes. User-facing only — no internal details.

---

## Context checklist

```
[ ] Read current README.md
[ ] Run: git log --oneline -20   (identify recent unreflected changes)
[ ] Identify which sections need updating (use section map below)
```

---

## Current State — README section map

| Section | Update trigger |
|---|---|
| Badges (npm, node) | Version bump or Node requirement change |
| Package list | New package added or removed |
| Quick start | CLI default flags changed, new required step |
| Config format | New top-level field or env var expansion behavior |
| Built-in strategies | New strategy added to virage-strategies |
| CLI flags/subcommands | New subcommand or flag added or removed |
| Plugin system | Plugin registration interface changed |

> **Keep this table current.** After adding a new README section, add a row here.

---

## Rules

- README is user-facing only — no internal architecture, pipeline stage names, or implementation details
- Code snippets must be copy-paste valid; test against actual `virage --help` output if in doubt
- Badge URLs follow the existing pattern — verify format before adding new ones
- Keep Quick Start under ~20 lines; link to docs for depth
- Package list must match the `packages/` directory — cross-check with `skill-package.md` inventory

---

## Update checklist

```
[ ] Use section map above to identify changed sections
[ ] Verify all CLI examples match current virage --help output
[ ] Verify all package names match packages/ directory
[ ] Verify config example includes no removed or renamed fields
[ ] Pre-commit hook fires automatically — no manual lint/format step needed
```

---

## After updating

Run `skill-overseer.md` reactive checklist if any section was added or removed.
