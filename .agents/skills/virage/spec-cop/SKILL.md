---
name: spec-cop
description: Track product capabilities (NOW.md) and planned intents (NEXT.md), detect contradictions with architecture (ADR.md) and package contracts (SPEC.md), escalate to human. Load when changing product behavior, public API, or architecture.
license: MIT
when_to_use:
  - "Changing a public API, CLI interface, or config schema"
  - "Detecting contradictions between NOW.md, NEXT.md, and ADR.md"
  - "Verifying a planned feature doesn't conflict with an active architectural decision"
  - "Updating product capability tracking after shipping a feature"
prerequisites: []
estimated_tokens: 672
output_format: "Contradiction report or updated NOW.md / NEXT.md with confirmed changes"
metadata:
  author: vivantel-team
  version: "1.1.0"
---

# Skill: Spec Cop

**Purpose:** Maintain coherent product specification by tracking current capabilities, planned intents, and package contracts. Escalate conflicts to humans.

---

## When to use

- Proposing new product capability or deprecation
- Planning breaking changes to public API
- Reviewing ADRs affecting product behavior
- Detecting contradictions between specs
- Weekly sync audit

---

## Core artifacts

| File | Ownership | Purpose |
|------|-----------|---------|
| `.agents/specs/NOW.md` | Team | Current capabilities |
| `.agents/specs/NEXT.md` | Product | Planned intents |
| `.agents/specs/CONTRADICTIONS.md` | Spec Cop | Active conflicts |
| `packages/*/SPEC.md` | Package owners | Public API contracts |
| `docs/ADR.md` | Architect | Technical decisions (read-only) |

## Contradiction types (auto-detect)

| Conflict | Detection |
|----------|-----------|
| NOW vs NEXT | Same capability in both |
| NOW vs ADR | ADR forbids claimed capability |
| NEXT vs ADR | ADR makes intent impossible |
| SPEC vs CODE | Exports mismatch (arethetypeswrong) |

## When to escalate

Contradiction is **BLOCKING** if:
- It affects shipped functionality (NOW.md)
- It breaks a public contract (SPEC.md stable)
- ADR explicitly forbids the change

Escalate with:
```
CON-XXX: <summary>
Sources: <files>
Severity: BLOCKING|MAJOR|MINOR
Options: (2-3 concrete choices)
Owners: @mentions
```

## Commands

| Request | Action |
|---------|--------|
| `@spec-cop status` | Show current coherence state |
| `@spec-cop validate` | Run full contradiction check |
| `@spec-cop verify <package>` | Check SPEC.md against code |
| `@spec-cop resolve CON-XXX --option N` | Record human decision |

## Integration with other skills

- **architect**: Reads ADR.md; spec-cop validates ADRs against specs
- **planner**: Reads next_plan.md; spec-cop checks alignment with NEXT.md
- **overseer**: Keeps skill inventory; spec-cop reports spec health

## Validation (pre-commit)

```bash
# Quick check
[ ] No duplicate capabilities between NOW.md and NEXT.md
[ ] SPEC.md exports match actual code (arethetypeswrong)
[ ] CONTRADICTIONS.md has no stale entries

# Full check (CI)
npm run type-check:ci   # TS project references
npx knip --exports      # Unused exports
```

For templates and detailed examples, see `references/templates/` and `references/examples.md`.
