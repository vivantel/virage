---
name: planner
description: Break a request into a sequenced, scope-bounded implementation plan, document it, and drive execution to verified completion.
license: MIT
when_to_use:
  - "Breaking down a complex request into ordered implementation steps"
  - "Creating or updating a plan in your project's planning directory"
  - "Tracking and driving execution of an in-flight implementation plan"
  - "Surfacing design decisions that need user input before proceeding"
prerequisites: []
estimated_tokens: 2100
output_format: "Plan written to your project's planning directory (default: PLAN.md) with checkbox-tracked steps"
metadata:
  author: vivantel-team
  version: "1.1.0"
---

# Skill: Planner

**Purpose:** Break a request into a sequenced, scope-bounded implementation plan, document it, and drive execution to verified completion.

---

## Role

**Tech Lead** — owns implementation quality from plan to verified completion.

Responsibilities:
- Translate requests into scope-bounded, risk-aware implementation plans
- Identify dependencies, risks, and unknowns before work starts — not during
- Enforce scope discipline: implement what was asked, log everything else as follow-up
- Surface design decisions before they become embedded implementation choices
- Sequence steps so each one is independently verifiable
- Track execution and unblock dependencies in real time
- Recognize when scope has expanded during execution and surface it before continuing

---

## When to use this skill

- Breaking down a complex request into ordered implementation steps
- Creating or updating a plan in your project's planning directory
- Tracking and driving execution of an in-flight implementation plan
- Surfacing design decisions that need user input before proceeding

---

## Context checklist

```
[ ] mcp__virage__search("<task keywords> cross-cutting rules commit ADR", top_k=3) — loads relevant INDEX.md sections and ADRs without reading the full files
[ ] mcp__virage__search("ADR <topic>", top_k=3) — scan result titles; if an ADR hit is ambiguous, Read that specific ADR entry only
[ ] Read the relevant skill file for the work type (.agents/skills/package/SKILL.md, .agents/skills/architect/SKILL.md, etc.)
[ ] Read your project's plan file — check for an existing in-flight plan before creating a new one
[ ] Understand the full request before writing a single step
```

> **Fallback:** if `mcp__virage__search` returns 0 results (index not populated), fall back to `Read docs/ai/INDEX.md` and `Read docs/ADR.md` directly.

---

## Current State — Active plan

| Property   | Value                                                       |
| ---------- | ----------------------------------------------------------- |
| Plan file  | Your project's plan file. Default fallback: `PLAN.md` in the project root. |
| Status key | `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped |

> **Keep this current.** Update checkbox states in the plan file as steps complete.

---

## Planning workflow

### Phase 1 — Understand

Before writing any step:

```
[ ] State the request back in one sentence — confirm scope
[ ] Identify affected packages, files, and cross-cutting concerns
[ ] Identify dependencies between pieces of work
[ ] Flag risks: external dependencies, steps with high variance, unknown unknowns
[ ] Flag any ambiguities that need a decision (see §Presenting alternatives)
[ ] Check the ADR gate (see §Architecture gate)
```

Do not proceed to Phase 2 until scope is clear and risks are identified.

---

### Phase 2 — Design

```
[ ] List steps in dependency order (prerequisite steps first)
[ ] Assign each step to the smallest self-contained unit of work
[ ] Identify which steps can be verified independently
[ ] Note which steps require a skill file load (.agents/skills/package/SKILL.md, .agents/skills/qa/SKILL.md, etc.)
[ ] Where alternatives exist, surface them now (see §Presenting alternatives)
```

---

### Phase 3 — Document

Write the plan to your project's plan file (default: `PLAN.md` in the project root) with this structure:

```markdown
# Plan: <title>

**Progress key:** `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped

---

## Context

<One paragraph: what this plan does and why, including any key design decisions made.>

---

## Steps

- [ ] Step 1 — <description>
- [ ] Step 2 — <description> (requires Step 1)
- [ ] Step 3 — <description>
      ...

---

## Verification checklist

- [ ] <check 1>
- [ ] <check 2>
```

---

### Phase 4 — Execute

```
[ ] Mark the active step [~] before starting it
[ ] Complete the step fully before moving to the next
[ ] Mark it [x] when done, [-] if skipped (note why inline)
[ ] Never start a step whose dependency is not yet [x]
[ ] Update the plan file after every state change
```

Execution rules (from `docs/ai/INDEX.md` §Planning rules):

- Steps execute in dependency order, not in parallel
- Wait for each step to complete before starting the next

---

### Phase 5 — Verify

After all steps reach `[x]` or `[-]`:

```
[ ] Run the verification checklist from the plan
[ ] Run your project's quality gate (see code-guard skill + INDEX.md §Code quality guardrails)
[ ] Stage files in a separate Bash call before git commit — never chain git add && git commit in one call or the pre-commit hook may not fire
[ ] If developer workflow changed: run overseer skill reactive checklist
[ ] If an ADR was written: update docs/ai/INDEX.md §ADR log
```

---

## Presenting alternatives

When a step has more than one viable approach, do not decide unilaterally. Present options in this table, then wait for a choice before writing the affected step.

```markdown
### Decision: <what needs to be decided>

| Option     | Summary    | Pros     | Cons     |
| ---------- | ---------- | -------- | -------- |
| A — <name> | <one line> | <bullet> | <bullet> |
| B — <name> | <one line> | <bullet> | <bullet> |

**Recommendation:** <option> — <one sentence rationale>. Confirm to proceed.
```

Use this format for decisions about:

- Implementation strategy (e.g. extend vs. replace vs. wrap)
- Where logic lives (which package, which layer)
- Interface shape choices with downstream consequences
- Naming that affects public API

For trivially reversible choices (variable names, internal file layout), decide and note the choice inline without blocking.

---

## Architecture gate

Write an ADR in `docs/ADR.md` **before implementing** when the plan includes any of:

- A new or changed public interface in your project's core package
- A change to the pipeline stage structure or sequence
- A cross-package contract (new shared type, new plugin registration field)
- A new external dependency whose API will be wrapped by an interface

Process: load the `architect` skill and follow its §ADR process section.

If unsure whether a change is architectural: err on the side of writing the ADR. It is cheaper to write a short ADR than to undo an undocumented interface decision.

---

## Scope discipline

- Implement exactly what the request asks. Do not add adjacent improvements unless asked.
- If a cleanup or improvement is clearly worthwhile, note it as a follow-up item at the bottom of the plan — do not fold it into the current steps.
- Do not introduce new abstractions unless they are required to satisfy the request.
- If the request is under-specified and scope is ambiguous, ask before writing the plan.
- If scope expands during execution (new requirement surfaces, a step is larger than estimated): stop, surface the change, and update the plan before continuing. Never silently absorb scope.

---

## Commit message format

Each commit from the plan follows your project's commit message convention. Find it in `docs/ai/INDEX.md` §Code quality guardrails. Conventional Commits is recommended:

| Change type | Prefix | Example |
| ----------- | ------ | ------- |
| New feature | `feat(<scope>):` | `feat(<package>): add streaming chunker` |
| Bug fix | `fix(<scope>):` | `fix(<package>): handle missing config path` |
| Non-functional | `chore(<scope>):` | `chore(docs): update planner skill` |
| Breaking change | `feat!(<scope>):` or append `[ADR-NNN]` | `feat!(<package>): replace VectorStore interface [ADR-006]` |

The `<scope>` is the package name or area (e.g., `docs`).

**Commit protocol:** Always run `git add <files>` in a separate Bash call, then `git commit -m "…"` in a second Bash call. Never chain them with `&&` — the pre-commit hook must see a command that contains `git commit` to fire.

---

## After the plan completes

```
[ ] Confirm the plan file shows all steps [x] or [-]
[ ] If any skill file content is now stale: run overseer skill reactive checklist
[ ] If an ADR was written: confirm docs/ai/INDEX.md §ADR log is updated
[ ] If a new skill was added: confirm docs/ai/INDEX.md §Skills and overseer skill §Current State are updated
```

**Retrospect note:** After completing a plan, briefly record what was estimated wrong and why. Improved estimation accuracy directly improves future plan quality. One sentence in the plan's Context section is enough: "Estimated 3 steps, took 5 — step 2 uncovered an unexpected interface dependency."
