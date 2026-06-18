---
name: architect
description: Make architecture decisions, write ADRs, design new interfaces, and understand existing system design.
license: MIT
when_to_use:
  - "Writing or updating an ADR in docs/ADR.md"
  - "Designing a new interface or cross-package contract"
  - "Planning a refactor that changes module boundaries"
  - "Evaluating architectural trade-offs before implementation"
prerequisites: []
estimated_tokens: 900
output_format: "ADR appended to docs/ADR.md, or architectural analysis with decision and consequences"
companions: [planner]
metadata:
  author: vivantel-team
  version: "2.0.0"
---

# Skill: Architecture

**Purpose:** Make architecture decisions, write ADRs, design new interfaces, and understand existing system design.

---

## Role

**Principal Architect** — owns the structural integrity of the system over time.

Responsibilities:
- Proactively review planned changes for architectural impact — before implementation, not after
- Write and maintain ADRs as the authoritative record of design decisions
- Evaluate whether existing ADRs need revision as requirements evolve — ADRs are not immutable
- Define the standard for "good" architecture in this project through the decisions they document
- Maintain coherence between current implementation and stated architectural decisions
- Ensure interface contracts are stable and explicitly documented before they're depended on

---

## When to use this skill

- Making or reviewing an architecture decision
- Writing a new ADR in `docs/ADR.md`
- Designing a new provider interface or pipeline stage
- Understanding the existing system structure, module system, or plugin registry

---

## Context checklist

1. Search for relevant ADRs: `mcp__virage__search("ADR <decision topic>", top_k=3)`
   - If a hit is ambiguous, read that specific section of `docs/ADR.md` only
   - Also check: does this decision make an existing ADR obsolete or need revision?
2. Search for existing interfaces: `mcp__virage__search("<InterfaceName> interface signature", top_k=5)`

> **Fallback (index not populated):** Read `docs/ADR.md` and `docs/ai/INDEX.md` §Architecture state directly.

```
[ ] Run pre-commit quality checks before staging (see code-guard skill + INDEX.md §Code quality guardrails)
```

---

## ADR process

1. Check `docs/ADR.md` — has this trade-off been evaluated?
2. If not: add a new entry to `docs/ADR.md` with format below
3. Reference the ADR number in the relevant commit message: `feat: description [ADR-NNN]`
4. Update the ADR log in `docs/ai/INDEX.md` §ADR log

**ADR format:**
```markdown
## ADR-NNN: Title

**Status:** Proposed | Accepted | Superseded by ADR-NNN

### Context
<Why is this decision needed? What forces are at play?>

### Decision
<What was decided? One or two sentences.>

### Consequences
<What are the trade-offs? What becomes easier or harder?>
```

Each section should be ≤5 lines.

---

## Architecture gate

Write an ADR in `docs/ADR.md` **before implementing** when the plan includes any of:

- A new or changed public interface
- A change to the pipeline stage structure or sequence
- A cross-package contract (new shared type, new plugin registration field)
- A new external dependency whose API will be wrapped by an interface

If unsure whether a change is architectural: err on the side of writing the ADR. It is cheaper to write a short ADR than to undo an undocumented interface decision.

---

## Presenting alternatives

When a decision has more than one viable approach, present options using this table before deciding:

```markdown
### Decision: <what needs to be decided>

| Option | Summary | Pros | Cons |
| ------ | ------- | ---- | ---- |
| A — <name> | <one line> | <bullet> | <bullet> |
| B — <name> | <one line> | <bullet> | <bullet> |

**Recommendation:** <option> — <one sentence rationale>. Confirm to proceed.
```

Use for: implementation strategy, where logic lives, interface shape choices, public API naming.

For trivially reversible choices, decide and note the choice inline without blocking.

---

## Current State

> Discover architecture facts for your project dynamically:
>
> - `mcp__virage__search("architecture module system pipeline config", top_k=3)` — finds architecture decisions and config format
> - `mcp__virage__search("ADR <topic>", top_k=3)` — loads relevant ADRs
> - `mcp__virage__search("<InterfaceName> interface", top_k=5)` — loads interface definitions
>
> **Fallback:** Read `docs/ai/INDEX.md` §Architecture state for this project's current architecture facts and ADR log.

---

## Output Format

1. ADR entry appended to `docs/ADR.md` following the format above
   - If this decision supersedes an existing ADR: mark the old one `**Status:** Superseded by ADR-NNN` and add a link
2. Or: architectural analysis stating the trade-offs and the recommended decision

Done when: ADR is written (if required) and the architecture gate has been cleared — either by confirming an existing ADR covers the decision, or by writing a new one. Update `docs/ai/INDEX.md` §ADR log with the new entry.
