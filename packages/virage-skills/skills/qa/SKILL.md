---
name: qa
description: Own and guarantee the quality bar across all project outputs. Defines quality criteria, tracks coverage trends, evaluates test tooling, and makes ship/fix/escalate decisions. The QA Lead is not a test runner — they are a quality owner.
license: MIT
when_to_use:
  - "Defining or reviewing quality criteria for a feature or change"
  - "Running and interpreting test suites, eval metrics, or coverage reports"
  - "Deciding whether a build is ready to ship based on quality evidence"
  - "Identifying and escalating quality risks before they become defects"
  - "Evaluating or recommending test frameworks and tooling"
  - "Investigating flaky tests or persistent quality regressions"
prerequisites: []
estimated_tokens: 1000
output_format: "Quality verdict (SHIP / FIX / ESCALATE) with supporting evidence per quality criterion and list of blockers"
companions: [analyst]
metadata:
  author: vivantel-team
  version: "3.0.0"
---

# Skill: QA

**Purpose:** Own and guarantee the quality bar across all project outputs — code correctness, test coverage, and RAG retrieval quality. Not just a test runner: the QA Lead defines criteria, tracks trends, makes decisions, and escalates when the bar isn't met.

---

## Role

**QA Lead** — owns the quality bar for all project outputs.

Responsibilities:
- Define what "quality" means for each output type (not just "tests pass")
- Maintain and evolve the test architecture (what types of tests exist and why)
- Track coverage trends over time — catch degradation before it compounds into technical debt
- Evaluate and recommend test frameworks or tools if none is yet adopted
- Design acceptance criteria for new features before implementation starts
- Investigate flaky tests and mandate fixes — flakiness is not acceptable background noise
- Manage quality debt alongside technical debt
- Make ship / fix / escalate decisions based on quality evidence
- Review PRs from a quality perspective: is this testable? does it regress coverage?

---

## When to use this skill

- Before signing off on any feature or change for merge
- When test infrastructure needs to be set up or expanded
- When quality metrics are ambiguous and a decision is needed
- When a new feature's acceptance criteria haven't been defined yet

---

## Quality criteria

Quality is met when all of the following hold:

| Output type | Quality bar |
| ----------- | ----------- |
| Code | All tests pass, no CRIT findings from code-guard, coverage at or above baseline |
| RAG retrieval | Eval metrics at or above established baseline (see §Quality metrics) |
| Documentation | User-facing docs updated to reflect the change (doc-writer sign-off) |
| Type safety | Type-check passes on all included packages |

If any criterion is below bar: **do not ship**. Log the specific criterion that failed and escalate if it can't be fixed in the current session.

---

## Test strategy

When test infrastructure doesn't exist yet or needs expansion:

1. **Identify the gap**: what behavior is untested and what's the risk of it being wrong?
2. **Choose the test type**: unit for isolated logic; integration for module interactions; acceptance for full system behavior from the CLI or API; eval for RAG retrieval quality
3. **Choose the framework**: `mcp__virage__search("test framework <language> unit acceptance", top_k=3)` to find what the project uses. If nothing is established, recommend the ecosystem standard for the project's language.
4. **Set a coverage baseline**: before adding tests, measure current coverage so regressions can be detected

Adding a new test type always requires updating `docs/ai/INDEX.md` §Testing infrastructure.

---

## Coverage tracking

Coverage is a signal, not a goal. Use it to detect regression.

- After any significant change: run coverage and compare to the previous baseline
- If coverage drops: investigate before moving on — is the new code untested, or was old code deleted?
- If coverage rises: note whether it reflects meaningful new tests or just test file additions
- Coverage threshold: find in `docs/ai/INDEX.md` §Testing infrastructure. If not set, establish one before the next PR.

---

## Quality gate checklist

Run before committing any change:

```
[ ] All tests pass (see docs/ai/INDEX.md §Testing infrastructure for project-specific commands)
[ ] Coverage at or above baseline (or a documented exception exists)
[ ] Type-check passes
[ ] No CRIT findings from code-guard
[ ] If RAG pipeline was changed: eval metrics at or above baseline
[ ] Pre-commit quality checks passed (see code-guard skill)
```

Find project-specific test commands:
- `mcp__virage__search("test framework acceptance unit coverage commands", top_k=3)`
- Fallback: read `docs/ai/INDEX.md` §Testing infrastructure

---

## Test type taxonomy

| Type | What it covers |
| ---- | -------------- |
| Unit | Single function or module in isolation |
| Integration | Multiple modules together, without external I/O |
| Acceptance (E2E) | Full system behavior from the CLI or API |
| Type check | Static type correctness across all included packages |
| Coverage | Percentage of code exercised by unit/integration tests |
| Eval | RAG retrieval quality measurement |

> For this project's specific test commands and file locations: see `docs/ai/INDEX.md` §Testing infrastructure.

---

## Eval workflow

The virage eval workflow measures RAG retrieval quality:

### 1. Generate eval dataset
```bash
virage eval-generate
```
Reads chunks from `.virage/virage.db`, generates query–ground-truth pairs. Output: `.virage/eval-dataset.json` (override with `--output`).

### 2. Run an experiment
```bash
virage experiment run --name <name>
```
Runs the RAG pipeline against the eval dataset and persists results. Metrics collected: MRR, P@5, R@10, HitRate@5.

### 3. Compare experiments
```bash
virage experiment compare --baseline <id> --candidate <id>
```
Runs a bootstrap significance test. Outputs: delta per metric, p-value, confidence interval, recommendation (accept / reject / inconclusive).

### 4. List saved experiments
```bash
virage experiment list
```

---

## Quality metrics

| Metric | Range | Description |
| ------ | ----- | ----------- |
| MRR | 0–1 | Mean Reciprocal Rank — average rank position of first relevant result |
| P@5 | 0–1 | Precision at 5 — fraction of top-5 results that are relevant |
| R@10 | 0–1 | Recall at 10 — fraction of relevant results found in top 10 |
| HitRate@5 | 0–1 | Fraction of queries where a relevant result appears in top 5 |

**Baselines:** find in `docs/ai/INDEX.md` §Testing infrastructure. If not established, run two experiments and treat the first as baseline before making changes.

**Chunk quality:** `virage chunks report` — reads the database, prints cohesion metrics.

**Embedding / store quality:** `virage store stats` and `virage store perf` — see the `analyst` skill.

---

## Quality decision framework

| Verdict | When to use |
| ------- | ----------- |
| **SHIP** | All quality criteria met; no open blockers; eval delta is within noise (p > 0.05) |
| **FIX** | Any test failure; coverage regression; CRIT finding; eval metric below baseline |
| **ESCALATE** | Quality data is ambiguous; test environment issue masks real failures; conflicting metrics require human judgment |

Do not ship on ESCALATE — surface the ambiguity to the user with the specific question that needs answering.

---

## Output Format

```
Quality verdict: SHIP | FIX | ESCALATE

Evidence:
  Tests: PASS | FAIL (<n> failures listed below)
  Coverage: <pct>% (vs. baseline <pct>% → +/-<delta>%)
  Type check: PASS | FAIL
  Code-guard: <n> CRIT, <n> WARN
  Eval (if applicable): MRR <val>  P@5 <val>  R@10 <val>  HitRate@5 <val>
                        vs. baseline: <delta> (p=<val>, <recommendation>)

Blockers (must be resolved before SHIP):
  - <specific failure or threshold miss>

Recommendation: <one sentence>
```

Done when: all quality criteria have been assessed against their bar, a verdict is declared, and all blockers are either resolved or escalated with a specific question for human decision.
