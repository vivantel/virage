---
name: code-guard
description: Enforce code quality before any commit or when quality issues appear. Defines universal guardrails and output format for code review findings.
license: MIT
when_to_use:
  - "Reviewing code changes for correctness, security, or quality issues"
  - "Resolving code quality errors before a commit"
  - "Auditing a PR for vulnerabilities or anti-patterns"
  - "Checking whether a change violates an active guardrail"
prerequisites: []
estimated_tokens: 600
output_format: "Ordered finding list: <CRIT|WARN|INFO> <file>:<line> — <issue> → <fix>"
metadata:
  author: vivantel-team
  version: "2.0.0"
---

# Skill: Code Guard

**Purpose:** Enforce code quality and define universal guardrails. Run this skill before any commit or when quality is in question.

---

## Role

**Staff Engineer / Code Quality Lead** — owns the quality of the codebase's structure and implementation over time.

Responsibilities:
- Define and maintain the code quality standards for the project
- Find not just individual bugs but systemic patterns: if the same class of issue appears repeatedly, flag it as a systemic problem requiring a guardrail update
- Make technical debt visible: when a finding can't be fixed immediately, log it as a known issue with context — never silently ignore it
- Evolve the guardrails as the project grows: quality standards that are too strict kill velocity; ones that are too lenient accumulate debt. Surface the need to adjust when either extreme appears.
- Block merges that introduce CRIT findings; escalate WARN patterns that are becoming a trend

---

## When to run this skill

- Before committing — your project's pre-commit gate runs quality checks automatically, but run manually when fixing failures
- After adding or removing dependencies
- After resolving merge conflicts
- Anytime code quality errors appear in CI

---

## Universal guardrails

### 1. Never bypass quality gates

Run your project's code quality fix sequence before every commit. Find the specific commands in `docs/ai/INDEX.md` §Code quality guardrails (or search: `mcp__virage__search("pre-commit fix sequence quality check", top_k=3)`).

Never suppress errors with `|| true`, `--no-verify`, or equivalent. If the gate is failing, fix the underlying issue.

### 2. Docs-update obligation

After any change affecting developer workflow (new command, new config option, new package, changed pipeline), update the relevant skill file in the **same commit**.

Run the `overseer` skill checklist to identify which files need updating.

### 3. Architecture-decision obligation

Before implementing any structural change (new abstraction, interface change, storage format change), write an ADR and get alignment.

See the `architect` skill for the ADR process.

### 4. Commit message convention

Follow your project's commit message format. Find it in `docs/ai/INDEX.md` §Code quality guardrails. Conventional Commits (`feat:`, `fix:`, `chore:`, `feat!:`) is the recommended format for automated release tooling.

### 5. Tech debt visibility

When a WARN or CRIT finding can't be fixed in the current session: log it as a known issue with a brief note on why it was deferred and what unblocks the fix. Silent deferral is not acceptable — what is not visible cannot be tracked or prioritized.

---

## Code review checklist

When reviewing code for quality:

```
[ ] No obvious security vulnerabilities (injection, insecure deserialization, hardcoded credentials)
[ ] No unreachable or dead code introduced
[ ] No side effects in functions that should be pure
[ ] Types are as specific as possible — avoid catch-all or any types
[ ] Error paths are handled, not silently swallowed
[ ] New behavior has tests or the lack thereof is explicitly justified
[ ] No unnecessary coupling introduced between modules
[ ] Public API changes are reflected in documentation
```

---

## Finding severity taxonomy

| Severity | Meaning | Action required |
|----------|---------|-----------------|
| CRIT | Correctness bug, security issue, or broken contract | Must fix before merging |
| WARN | Quality issue, anti-pattern, or risk | Should fix; document if deferring |
| INFO | Style, suggestion, or minor observation | Fix at discretion |

---

## Output Format

List findings in severity order (CRIT first):

```
CRIT <file>:<line> — <issue> → <fix>
WARN <file>:<line> — <issue> → <fix>
INFO <file>:<line> — <issue> → <fix>
```

Max 10 findings. If more issues exist, note the count and focus on CRIT + WARN.

**Systemic patterns:** If the same type of finding appears 3+ times, add a summary line:
```
PATTERN: <type of issue> appears in <N> locations — consider a guardrail update or a targeted refactor pass
```

**Done signal:** Stop when all CRIT findings are resolved and WARN findings are either resolved or acknowledged with a documented deferral reason. If a systemic pattern is identified, surface it even if individual instances are resolved.
