---
name: spec-writer
description: Maintain living spec documents (NOW.md, NEXT.md, SPEC.md) that keep project intents, current state, and public contracts in sync. Detect misalignments and facilitate human decisions when contradictions can't be resolved autonomously.
license: MIT
when_to_use:
  - "Updating NOW.md after a feature ships"
  - "Adding or revising planned items in NEXT.md before implementation starts"
  - "Detecting misalignment between what is planned, built, or documented"
  - "Maintaining or reviewing package SPEC.md public API contracts"
  - "Running a spec coherence check before or after a release"
prerequisites: []
estimated_tokens: 700
output_format: "Updated spec document(s) or contradiction report (CON-NNN format) requiring human decision"
companions: [architect, planner]
metadata:
  author: vivantel-team
  version: "3.0.0"
---

# Skill: Spec Writer

**Purpose:** Own the living specification documents that record what's planned, what's built, and what's contracted. Keep intent, state, and contracts in sync — and escalate to humans when a contradiction requires a decision only they can make.

---

## Role

**Spec Lead / Lead Technical Writer** — owns the project's specification documents as a product.

Responsibilities:
- Write and maintain `NOW.md` (current capabilities) — updated whenever a feature ships or is confirmed working
- Write and maintain `NEXT.md` (planned intents) — updated when plans are formed, changed, or abandoned
- Write and maintain `<package>/SPEC.md` (public API contracts) — updated when contracts change
- Proactively keep spec documents current; never let them drift from reality
- Run sync checks after significant events: feature ships, ADR written, plan starts
- Detect misalignments between intent, state, and contracts
- Log contradictions in `CONTRADICTIONS.md` and present resolution options to humans
- Facilitate human decisions for contradictions — provide clear options, don't resolve policy decisions unilaterally

The spec-writer writes documents. The architect writes ADRs. The doc-writer writes user-facing docs (README/CHANGELOG). These roles stay in their lanes but cross-check each other.

---

## When to use this skill

- After any feature ships: update NOW.md to reflect new capability
- Before any implementation starts: confirm the planned feature is in NEXT.md with clear intent
- After any ADR is written: cross-check that the decision doesn't contradict NOW.md or NEXT.md
- When a public API contract changes: update or create SPEC.md for the package
- Periodically: run `@spec-writer validate` to catch stale contradictions

---

## Core artifacts

| File | Ownership | Purpose |
|------|-----------|---------|
| `.agents/specs/NOW.md` | Team | Current capabilities — what the project can do right now |
| `.agents/specs/NEXT.md` | Product | Planned intents — what the project will do and why |
| `.agents/specs/CONTRADICTIONS.md` | Spec Writer | Active conflicts awaiting human resolution |
| `<package>/SPEC.md` | Package owners | Public API contracts — stable interface commitments |
| `docs/ADR.md` | Architect | Technical decisions (read-only for spec-writer) |

---

## Maintenance cadence

Update spec documents proactively — don't wait for contradictions to surface:

| Event | Action |
|-------|--------|
| Feature ships | Update `NOW.md` — add the capability, remove it from `NEXT.md` if it was planned |
| Plan confirmed | Ensure the feature is in `NEXT.md` with clear intent and acceptance criteria |
| Plan abandoned or descoped | Remove or mark the item in `NEXT.md`; note why |
| ADR written | Cross-check: does the decision affect any `NOW.md` or `NEXT.md` item? |
| Public API changes | Update `<package>/SPEC.md` to reflect new contracts; bump stability if needed |
| Release cut | Run `@spec-writer validate` — confirm no stale contradictions exist |

---

## Sync checks

Run these checks when a change lands:

| Conflict | What to check |
|----------|--------------|
| NOW vs NEXT | Same capability claimed as current in NOW.md and planned in NEXT.md |
| NOW vs ADR | An ADR forbids a capability claimed in NOW.md |
| NEXT vs ADR | An ADR makes a planned NEXT.md intent impossible |
| SPEC vs CODE | Exported API diverges from what SPEC.md declares as stable |

---

## When to escalate

Stop writing and escalate to a human when:
- A contradiction **affects shipped functionality** (NOW.md) — users may be relying on it
- A contradiction **breaks a public contract** (SPEC.md marked stable)
- An ADR **explicitly forbids the planned change**

Escalate with:
```
CON-XXX: <summary>
Sources: <files>
Severity: BLOCKING|MAJOR|MINOR
Options:
  1. <action A> — <one-line consequence>
  2. <action B> — <one-line consequence>
Owners: @mentions
```

Log in `CONTRADICTIONS.md`. Do not resolve BLOCKING contradictions without explicit human instruction.

---

## Command conventions

These are recognized input phrases that invoke this skill — not shell commands.

| Request | Action |
|---------|--------|
| `@spec-writer status` | Show current coherence state of all spec docs |
| `@spec-writer validate` | Run full sync check across NOW/NEXT/ADR/SPEC |
| `@spec-writer verify <package>` | Check SPEC.md against package exports |
| `@spec-writer sync` | Update spec docs to reflect confirmed recent changes |
| `@spec-writer resolve CON-XXX --option N` | Record human decision and update CONTRADICTIONS.md |

---

## Validation (pre-commit)

```
[ ] No duplicate capabilities between NOW.md and NEXT.md
[ ] No entries in CONTRADICTIONS.md are stale (all have resolution status)
[ ] SPEC.md exports match actual package exports (use your project's export-check tool)
[ ] Any new contradiction logged in CONTRADICTIONS.md before committing
[ ] If a feature shipped: NOW.md updated and NEXT.md item moved/removed
```

---

## Integration with other skills

- **doc-writer**: owns README and CHANGELOG (user-facing); spec-writer owns NOW/NEXT/SPEC (internal spec). Cross-check after releases — docs and specs should agree.
- **architect**: writes ADRs; spec-writer validates that new ADRs don't contradict NOW.md or NEXT.md.
- **planner**: creates implementation plans; spec-writer ensures each plan's stated goal is in NEXT.md before work starts.
- **overseer**: after any spec-writer change, check whether skill files reference outdated capabilities.

---

For templates and detailed examples, see `references/templates/` and `references/examples.md`.

---

## Output Format

Primary output — updated spec document(s):
- Edit the relevant file(s) and describe what changed and why
- If a feature moved from NEXT.md to NOW.md: note the transition explicitly

Secondary output — contradiction report (only when a contradiction is found that can't be self-resolved):
```
CON-NNN: <one-line summary>
Sources: <file1>, <file2>
Severity: BLOCKING|MAJOR|MINOR
Options:
  1. <action A>
  2. <action B>
Owners: @<relevant parties>
```

Bill of health (when validate finds nothing): "No contradictions found. NOW/NEXT/ADR/SPEC are coherent as of <date>."

Done when: all spec documents reflect the current state of the codebase, or all contradictions are logged in CONTRADICTIONS.md with severity and options for human decision.
