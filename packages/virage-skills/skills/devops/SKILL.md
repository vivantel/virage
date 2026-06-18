---
name: devops
description: Modify CI/CD workflows and release configuration for a monorepo.
license: MIT
when_to_use:
  - "Editing CI/CD workflow files"
  - "Changing release automation or publish configuration"
  - "Adding environment variables or secrets to CI"
  - "Diagnosing a failed CI run or pipeline step"
prerequisites: []
estimated_tokens: 700
output_format: "Updated workflow file or config, with explanation of change and expected CI behavior"
companions: [package]
metadata:
  author: vivantel-team
  version: "2.0.0"
---

# Skill: CI/CD and Release

**Purpose:** Modify CI/CD workflows and release configuration.

---

## Role

**Platform Lead** — owns the reliability and reproducibility of the build, test, and release pipeline.

Responsibilities:
- Keep the CI pipeline passing and stable — flaky pipelines are not tolerated as background noise
- Design for reproducibility: a clean checkout and a `ci install + build + test` should always succeed
- Own the release strategy: versioning scheme, publish criteria, rollback procedures
- Investigate and fix CI failures proactively — don't let failures accumulate
- Assess pipeline health before making configuration changes — never modify a pipeline that's already degraded
- Minimize environment drift between local and CI by making CI the source of truth

---

## When to use this skill

- Adding or modifying CI/CD workflows
- Wiring a new package into the release matrix
- Debugging failing CI runs or release jobs
- Changing workflow triggers, secrets, or matrix configuration

---

## Context checklist

1. Discover current workflow state: `mcp__virage__search("CI workflow release trigger publish", top_k=5)`
   - Fallback: list and read the CI configuration directory for your project (e.g., `.github/workflows/`)
2. **Check pipeline health first**: are recent CI runs passing consistently? Is there flakiness? Do not make configuration changes on top of a degraded pipeline — fix instability first.
3. Identify which workflow(s) to change
4. For release changes: check your project's release manifest for current versions

```
[ ] Run pre-commit quality checks before staging (see code-guard skill + INDEX.md §Code quality guardrails)
```

---

## Adding a new package to CI/CD

When a new publishable package is added, update your project's:

1. **Release manifest** — add entry for the new package with its initial version
2. **Release automation job** — add the package to the automated publish trigger
3. **CI path filter** — add the package path so CI runs on changes to that package
4. **Skill inventories** — update `docs/ai/INDEX.md` §Package inventory and §CI/CD and release state

> For this project's specific CI file locations and formats: see `docs/ai/INDEX.md` §CI/CD and release state.

If the new package has native binary postinstall scripts: configure your CI dependency installation step to skip those scripts, then run them separately if needed.

---

## Release process concepts

- Release automation reads commit messages to determine version bumps (minor, patch, major)
- Pre-publish verification runs build + test before any package is published
- Private packages are excluded from release automation

---

## Common tasks

**Add a CI secret:**
1. Add the secret in your CI provider's settings
2. Reference it in the relevant workflow step via the provider's secret syntax

**Change a workflow trigger:**
Edit the trigger block: push branches, pull request branches, schedule, etc.

**Handle a native postinstall package:**
Find the dependency installation step in CI; configure it to skip scripts for that package.

---

## Current State

> Discover current CI/CD state for your project:
>
> - `mcp__virage__search("CI workflow release publish matrix", top_k=5)`
> - Fallback: read `docs/ai/INDEX.md` §CI/CD and release state

---

## Validation after CI changes

1. Push to a branch → open PR → watch the CI run
2. Verify the path-filter job correctly identifies changed packages
3. For release config changes: validate with a dry-run before merging to the main branch

## Output Format

Updated workflow file or release config file. Include a one-paragraph explanation of:
- What changed and why
- Expected CI behavior after the change

Done when: CI runs successfully on a branch with the changed config, the changed-path detection behaves as expected, and a rollback path is identified in case the change causes unexpected failures in production.
