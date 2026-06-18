---
name: overseer
description: Keep all skill files in sync with the actual codebase after any structural change. Run reactively after adding a package, changing CI, updating the pipeline, writing an ADR, etc.
license: MIT
when_to_use:
  - "After adding or removing a package from the monorepo"
  - "After writing a new ADR or changing CI configuration"
  - "After a pipeline or interface refactor that affects multiple skills"
  - "When a skill file references a file path or CLI command that no longer exists"
prerequisites: []
estimated_tokens: 1100
output_format: "Updated skill files with accurate file paths, commands, and cross-references"
metadata:
  author: vivantel-team
  version: "2.0.0"
---

# Skill: AI Skills Overseer

**Purpose:** Keep all `.agents/skills/virage/` skill files in sync with the actual codebase after any structural change. Run this skill reactively — after adding a package, changing CI, updating the pipeline, writing an ADR, etc.

---

## Role

**Engineering Manager / Knowledge Base Steward** — owns coherence across all project artifacts and skills.

Responsibilities:
- Maintain the cross-reference graph: every skill inventory, doc table, and path reference must be accurate
- Run proactive audits, not just reactive fixes — schedule a sync check after each milestone or major refactor
- Identify stale documentation before it causes agent errors or misleading suggestions
- Ensure the skills accurately reflect what the codebase actually does, not what it once did
- Track the breadth of changes: a single rename can touch 5+ files — verify the full blast radius

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

Alphabetical. Must stay in sync with `skill-writer/SKILL.md` §Current Skill Inventory and `docs/ai/INDEX.md` §Skills.

| Skill file | Covers | Key snapshot to verify |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `.agents/skills/virage/analyst/SKILL.md` | Domain context synthesis: intent vs. state, gap identification, recommendations | Context gather order, analysis workflow |
| `.agents/skills/virage/architect/SKILL.md` | Architecture decisions, ADR process, interface design | ADR process, gate trigger conditions |
| `.agents/skills/virage/code-guard/SKILL.md` | Code quality guardrails, commit protocol, finding format | Universal guardrails list, output format |
| `.agents/skills/virage/devops/SKILL.md` | CI/CD workflows and release configuration | CI concept checklist |
| `.agents/skills/virage/doc-writer/SKILL.md` | Root README section map | Section triggers table |
| `.agents/skills/virage/onboarding/SKILL.md` | Agent self-orientation: reads skills, applies hooks and env config | MCP tool usage, §Instructions |
| `.agents/skills/virage/overseer/SKILL.md` | This file — skill sync | Skill inventory table (this table) |
| `.agents/skills/virage/package/SKILL.md` | Package lifecycle (add/update/develop/sync/test) | Package lifecycle workflow, §Add steps |
| `.agents/skills/virage/planner/SKILL.md` | Implementation planning: phases, alternatives format, ADR gate, progress tracking | Plan structure, §Presenting alternatives format |
| `.agents/skills/virage/qa/SKILL.md` | Testing strategy: unit, acceptance, eval, quality metrics | Test type taxonomy, eval workflow |
| `.agents/skills/virage/skill-writer/SKILL.md` | Agent Skills v1.0 standard, skill organization rules, validation checklist | Frontmatter rules, skill inventory |
| `.agents/skills/virage/spec-writer/SKILL.md` | Spec authorship: maintain NOW.md + NEXT.md + SPEC.md in sync, detect misalignments, escalate contradictions to human | Core artifacts table, §When to escalate |

> **Keep this table current.** After adding a skill file, add a row here and add a row to the `docs/ai/INDEX.md` Skills table.

---

## Proactive audit cadence

In addition to the reactive checklist, run a full coherence audit after each milestone or major refactor:

```
[ ] Read every skill file and verify the "Key snapshot to verify" column is still accurate
[ ] Confirm all path references in all skills still exist
[ ] Confirm all CLI command examples still match the actual CLI
[ ] Confirm all skill inventory tables (overseer, skill-writer, docs/ai/INDEX.md) are consistent with each other
[ ] After any skill is added or renamed: verify the full cross-reference graph —
    a single rename touches at least 5 files (SKILL.md, SKILL.summary.md, overseer, skill-writer, docs/ai/INDEX.md)
```

---

## Reactive checklist

Run the relevant items after a structural change:

```
[ ] Package added/removed
      → package/SKILL.md §Current State (if using local inventory)
      → devops/SKILL.md §CI concept checklist

[ ] CLI command added or changed
      → docs/ai/INDEX.md §Essential commands (if commonly used)

[ ] Pipeline stage added, removed, or reconfigured
      → docs/ai/INDEX.md §Architecture state

[ ] New provider interface or major type added
      → docs/ai/INDEX.md §Architecture state

[ ] CI/CD workflow added, renamed, or restructured
      → docs/ai/INDEX.md §CI/CD and release state

[ ] New ADR written
      → docs/ai/INDEX.md §ADR log (add a row)

[ ] New test type or test infrastructure added
      → docs/ai/INDEX.md §Testing infrastructure

[ ] New telemetry field or artifact path added
      → analyst/SKILL.md §Current State (artifact locations or diagnostic commands)

[ ] New skill file added or renamed
      → overseer/SKILL.md §Current State (this table)
      → docs/ai/INDEX.md §Skills (decision table)
      → .agents/skills/virage/ (copy updated SKILL.md into the active skills directory)

[ ] Skill file content changed in .agents/skills/virage/
      → confirm the source skill file is also updated (skills may be distributed from an upstream package)

[ ] New plan written or completed
      → update checkbox states in your project's plan file (see planner skill)
```

---

## Before committing

```
[ ] Run pre-commit quality checks (see code-guard skill)
```

---

## How to update a skill file

1. Identify which snapshot section is stale (use the "Key snapshot to verify" column above)
2. Read the actual source files to get current state
3. Update the `## Current State` section in the skill file
4. Check that no other cross-references in the same skill point to the old state

---

## Self-maintenance

This file's `§Current State` table must be updated whenever any skill file is added, renamed, or removed. The `docs/ai/INDEX.md` Skills table must also be updated at the same time.

For skill format rules and validation, see `skill-writer/SKILL.md`.
