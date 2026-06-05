# Skill: Planner

**Purpose:** Break a request into a sequenced, scope-bounded implementation plan, document it, and drive execution to verified completion.

---

## Context checklist

```
[ ] Read docs/ai/INDEX.md — cross-cutting rules (imports, commit style, pre-commit hook, ADR gate)
[ ] Read the relevant skill file for the work type (skill-package.md, skill-architect.md, etc.)
[ ] Read docs/ADR.md — check whether any proposed design touches an already-decided trade-off
[ ] Read docs/internal/next_plan.md — check for an existing in-flight plan before creating a new one
[ ] Understand the full request before writing a single step
```

---

## Current State — Active plan

| Property | Value |
|---|---|
| Plan file | `docs/internal/next_plan.md` |
| Status key | `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped |

> **Keep this current.** Update checkbox states in `docs/internal/next_plan.md` as steps complete.

---

## Planning workflow

### Phase 1 — Understand

Before writing any step:

```
[ ] State the request back in one sentence — confirm scope
[ ] Identify affected packages, files, and cross-cutting concerns
[ ] Identify dependencies between pieces of work
[ ] Flag any ambiguities that need a decision (see §Presenting alternatives)
[ ] Check the ADR gate (see §Architecture gate)
```

Do not proceed to Phase 2 until scope is clear.

---

### Phase 2 — Design

```
[ ] List steps in dependency order (prerequisite steps first)
[ ] Assign each step to the smallest self-contained unit of work
[ ] Identify which steps can be verified independently
[ ] Note which steps require a skill file load (skill-package.md, skill-qa.md, etc.)
[ ] Where alternatives exist, surface them now (see §Presenting alternatives)
```

---

### Phase 3 — Document

Write the plan to `docs/internal/next_plan.md` with this structure:

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
[ ] Update docs/internal/next_plan.md after every state change
```

Execution rules (from INDEX.md §Planning rules):
- Steps execute in dependency order, not in parallel
- Wait for each step to complete before starting the next

---

### Phase 5 — Verify

After all steps reach `[x]` or `[-]`:

```
[ ] Run the verification checklist from the plan
[ ] Run: npm run type-check:ci
[ ] Run: npm run lint
[ ] Confirm pre-commit hook will pass (it auto-runs npm run fix && npm run lint && npm run type-check:ci)
[ ] If developer workflow changed: run skill-overseer.md reactive checklist
[ ] If an ADR was written: update skill-architect.md §ADR log
```

---

## Presenting alternatives

When a step has more than one viable approach, do not decide unilaterally. Present options in this table, then wait for a choice before writing the affected step.

```markdown
### Decision: <what needs to be decided>

| Option | Summary | Pros | Cons |
|---|---|---|---|
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

- A new or changed public interface (`packages/virage-core/src/interfaces/`)
- A change to the pipeline stage structure or sequence
- A cross-package contract (new shared type, new plugin registration field)
- A new external dependency whose API will be wrapped by an interface

Process: load `skill-architect.md` and follow its §ADR process section.

If unsure whether a change is architectural: err on the side of writing the ADR. It is cheaper to write a short ADR than to undo an undocumented interface decision.

---

## Scope discipline

- Implement exactly what the request asks. Do not add adjacent improvements unless asked.
- If a cleanup or improvement is clearly worthwhile, note it as a follow-up item at the bottom of the plan — do not fold it into the current steps.
- Do not introduce new abstractions unless they are required to satisfy the request.
- If the request is under-specified and scope is ambiguous, ask before writing the plan.

---

## Commit message format

Each commit from the plan follows Conventional Commits (drives release-please versioning):

| Change type | Prefix | Example |
|---|---|---|
| New feature | `feat(<scope>):` | `feat(virage-core): add streaming chunker` |
| Bug fix | `fix(<scope>):` | `fix(virage-cli): handle missing config path` |
| Non-functional | `chore(<scope>):` | `chore(docs): update skill-planner` |
| Breaking change | `feat!(<scope>):` or append `[ADR-NNN]` | `feat!(virage-core): replace VectorStore interface [ADR-006]` |

The `<scope>` is the package name (without `@vivantel/`) or `docs`.

---

## After the plan completes

```
[ ] Confirm docs/internal/next_plan.md shows all steps [x] or [-]
[ ] If any skill file content is now stale: run skill-overseer.md reactive checklist
[ ] If an ADR was written: confirm skill-architect.md §ADR log is updated
[ ] If a new skill was added: confirm INDEX.md §Skills and skill-overseer.md §Current State are updated
```
