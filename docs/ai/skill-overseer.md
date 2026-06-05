# Skill: AI Skills Overseer

**Purpose:** Keep all `docs/ai/` skill files in sync with the actual codebase after any structural change. Run this skill reactively — after adding a package, changing CI, updating the pipeline, writing an ADR, etc.

---

## When to run this skill

Trigger on any of these events:
- Package added or removed
- Pipeline stage changed (new stage, changed storage format, new config option)
- New CLI subcommand or flag added
- New provider interface or major type added
- CI/CD workflow structure changed
- New ADR written
- New test pattern established
- New telemetry field added
- New skill file added, renamed, or removed

---

## Current State — Skill inventory

| Skill file | Covers | Key snapshot to verify |
|---|---|---|
| `skill-planner.md` | Implementation planning: phases, alternatives format, ADR gate, progress tracking | Plan structure, §Presenting alternatives format |
| `INDEX.md` | Decision table, commands, cross-cutting rules, memory slugs | Decision table rows, command list |
| `skill-readme.md` | Root README section map | Section triggers table |
| `skill-package.md` | Package lifecycle (add/update/develop/sync/test) | Package inventory table, §Add steps |
| `skill-cicd.md` | Workflows + release config | Workflow map, published packages list |
| `skill-overseer.md` | This file — skill sync | Skill inventory table (this table) |
| `skill-architect.md` | Architecture principles, ADR process, interfaces, patterns | Architecture facts, ADR log |
| `skill-qa.md` | Testing strategy: unit, acceptance, eval, quality metrics | Test type map, eval workflow |
| `skill-analyst.md` | Telemetry, artifact locations, diagnostic commands | Artifact paths, diagnostic commands list |

> **Keep this table current.** After adding a skill file, add a row here and add a row to the `INDEX.md` decision table.

---

## Reactive checklist

Run the relevant items after a structural change:

```
[ ] Package added/removed
      → skill-package.md §Current State (package inventory table)
      → skill-cicd.md §Current State (published packages list, if publishable)

[ ] CLI command added or changed
      → INDEX.md §Essential commands (if commonly used)

[ ] Pipeline stage added, removed, or reconfigured
      → skill-architect.md §Pipeline stages

[ ] New provider interface or major type added
      → skill-architect.md §Provider interfaces

[ ] CI/CD workflow added, renamed, or restructured
      → skill-cicd.md §Current State (workflow file map)

[ ] New ADR written
      → skill-architect.md §ADR log (add a row)

[ ] New test type or test infrastructure added
      → skill-qa.md §Current State (test type map)

[ ] New telemetry field or artifact path added
      → skill-analyst.md §Current State (artifact locations or diagnostic commands)

[ ] New skill file added or renamed
      → skill-overseer.md §Current State (this table)
      → INDEX.md §Skills (decision table)

[ ] New plan written or completed
      → docs/internal/next_plan.md (update checkbox states)
```

---

## How to update a skill file

1. Identify which snapshot section is stale (use the "Key snapshot to verify" column above)
2. Read the actual source files (`packages/`, `.github/workflows/`, etc.) to get current state
3. Update the `## Current State` section in the skill file
4. Check that no other cross-references in the same skill point to the old state

---

## Self-maintenance

This file's `§Current State` table must be updated whenever any skill file is added, renamed, or removed. The `INDEX.md` decision table must also be updated at the same time.
