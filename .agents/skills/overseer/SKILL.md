---
name: overseer
description: Keep all skill files in sync with the actual codebase after any structural change. Run reactively after adding a package, changing CI, updating the pipeline, writing an ADR, etc.
license: MIT
metadata:
  author: vivantel-team
  version: "1.0.0"
---

# Skill: AI Skills Overseer

**Purpose:** Keep all `.agents/skills/` skill files in sync with the actual codebase after any structural change. Run this skill reactively — after adding a package, changing CI, updating the pipeline, writing an ADR, etc.

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

| Skill file                                | Covers                                                                            | Key snapshot to verify                          |
| ----------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| `.agents/skills/spec-cop/SKILL.md`        | Spec coherence: track capabilities (NOW.md) + intents (NEXT.md), detect contradictions, escalate to human | CONTRADICTIONS.md format, §Escalation protocol |
| `.agents/skills/planner/SKILL.md`         | Implementation planning: phases, alternatives format, ADR gate, progress tracking | Plan structure, §Presenting alternatives format |
| `docs/ai/INDEX.md`                        | Decision table, commands, cross-cutting rules, memory slugs                       | Decision table rows, command list               |
| `.agents/skills/readme/SKILL.md`          | Root README section map                                                           | Section triggers table                          |
| `.agents/skills/package/SKILL.md`         | Package lifecycle (add/update/develop/sync/test)                                  | Package inventory table, §Add steps             |
| `.agents/skills/devops/SKILL.md`            | Workflows + release config                                                        | Workflow map, published packages list           |
| `.agents/skills/overseer/SKILL.md`        | This file — skill sync                                                            | Skill inventory table (this table)              |
| `.agents/skills/architect/SKILL.md`       | Architecture principles, ADR process, interfaces, patterns                        | Architecture facts, ADR log                     |
| `.agents/skills/qa/SKILL.md`              | Testing strategy: unit, acceptance, eval, quality metrics                         | Test type map, eval workflow                    |
| `.agents/skills/analyst/SKILL.md`         | Telemetry, artifact locations, diagnostic commands                                | Artifact paths, diagnostic commands list        |
| `.agents/skills/code-guardian/SKILL.md`   | Guardrails, style rules, active fix sequence                                      | Active guardrails list, fix sequence steps      |
| `.agents/skills/skill-guru/SKILL.md`      | Agent Skills v1.0 standard, skill organization rules, validation checklist        | Frontmatter rules, skill inventory              |

> **Keep this table current.** After adding a skill file, add a row here and add a row to the `docs/ai/INDEX.md` decision table.

---

## Reactive checklist

Run the relevant items after a structural change:

```
[ ] Package added/removed
      → .agents/skills/package/SKILL.md §Current State (package inventory table)
      → .agents/skills/devops/SKILL.md §Current State (published packages list, if publishable)

[ ] CLI command added or changed
      → docs/ai/INDEX.md §Essential commands (if commonly used)

[ ] Pipeline stage added, removed, or reconfigured
      → .agents/skills/architect/SKILL.md §Pipeline stages

[ ] New provider interface or major type added
      → .agents/skills/architect/SKILL.md §Provider interfaces

[ ] CI/CD workflow added, renamed, or restructured
      → .agents/skills/devops/SKILL.md §Current State (workflow file map)

[ ] New ADR written
      → .agents/skills/architect/SKILL.md §ADR log (add a row)

[ ] New test type or test infrastructure added
      → .agents/skills/qa/SKILL.md §Current State (test type map)

[ ] New telemetry field or artifact path added
      → .agents/skills/analyst/SKILL.md §Current State (artifact locations or diagnostic commands)

[ ] New skill file added or renamed
      → .agents/skills/overseer/SKILL.md §Current State (this table)
      → docs/ai/INDEX.md §Skills (decision table)

[ ] New plan written or completed
      → docs/internal/next_plan.md (update checkbox states)
```

---

## Before committing

```
[ ] Before committing: npm run fix && npm run lint && npm run type-check:ci (see .agents/skills/code-guardian/SKILL.md)
```

---

## How to update a skill file

1. Identify which snapshot section is stale (use the "Key snapshot to verify" column above)
2. Read the actual source files (`packages/`, `.github/workflows/`, etc.) to get current state
3. Update the `## Current State` section in the skill file
4. Check that no other cross-references in the same skill point to the old state

---

## Self-maintenance

This file's `§Current State` table must be updated whenever any skill file is added, renamed, or removed. The `docs/ai/INDEX.md` decision table must also be updated at the same time.

For skill format rules and validation, see `.agents/skills/skill-guru/SKILL.md`.
