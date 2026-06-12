---
name: code-guardian
description: Enforce code quality and serve as the canonical reference for all active guardrails in this repo. Run before any commit or when lint/type errors appear.
license: MIT
metadata:
  author: vivantel-team
  version: "1.0.0"
---

# Skill: Code Guardian

**Purpose:** Enforce code quality and serve as the canonical reference for all active guardrails in this repo. Run this skill whenever quality is in question or before any commit.

---

## When to run this skill

- Before committing (the pre-commit hook runs the fix sequence automatically, but run manually when fixing failures)
- After adding or removing packages (new files may not be covered by existing lint scope)
- After resolving merge conflicts
- Anytime lint, format, or type errors appear in CI

---

## Active guardrails

### 1. Module import extensions

All internal imports must use `.js` extensions — even though source files are `.ts`.

```ts
// correct (NodeNext resolution)
import { foo } from "./foo.js";

// wrong
import { foo } from "./foo";
```

**Why:** TypeScript `NodeNext` module resolution requires the runtime extension. Omitting it causes import failures at runtime even when compilation succeeds.

### 2. Conventional Commits

All commit messages must follow the Conventional Commits spec:

| Prefix             | Use for                                       |
| ------------------ | --------------------------------------------- |
| `feat:`            | New user-visible feature                      |
| `fix:`             | Bug fix                                       |
| `chore:`           | Maintenance, dependency bumps, config         |
| `feat!:` / `fix!:` | Breaking change (triggers major version bump) |

**Why:** `release-please` reads commit prefixes to generate changelogs and bump versions automatically.

### 3. Docs-update obligation

After any change affecting developer workflow (new command, new config option, new package, changed pipeline stage), update the relevant skill file in `.agents/skills/` in the **same commit**.

Run `.agents/skills/overseer/SKILL.md` checklist to identify which files need updating.

### 4. Architecture-decision obligation

Before implementing any structural change (new abstraction, interface change, storage format change), write an ADR entry in `docs/ADR.md` and get alignment. See `.agents/skills/architect/SKILL.md`.

### 5. Pre-commit hook

`.claude/settings.json` wires a `PreToolUse` hook on `git commit` that runs the full fix sequence automatically. Never bypass with `--no-verify` or `|| true`.

**Hook trigger constraint:** The hook matcher fires on any Bash command that *contains* `git commit`. However, to guarantee it fires, always run `git add` in a **separate** Bash call before `git commit` — never chain them with `&&` in a single Bash call.

**Required commit protocol:**
1. Bash call 1 — stage files: `git add <specific files>`
2. Bash call 2 — commit: `git commit -m "…"`

### 6. Build order: base packages in `build:all`

`build:all` must explicitly pre-build packages whose compiled `dist/` is required by other workspace packages before `tsc` can compile them. `dist/` is in `.gitignore`, so a fresh clone has no compiled output — `npm run build --workspaces --if-present` would fail for any plugin that alphabetically precedes its base dependency.

Currently required pre-build order:

1. `virage-core` — required by stores, embedders, strategies, CLI, MCP packages
2. `virage-agent-core` — required by all four agent plugin packages

**Trigger:** After adding a workspace package that other packages import types from at compile time.

**Check:** After adding such a package, verify `build:all` works from a clean state:

```bash
npm run clean && npm run build:all
```

If it fails with missing module/type errors pointing to a workspace `dist/`, add that package as an explicit pre-build step **before** the final `--workspaces --if-present` pass in `build:all`.

**Current `build:all` shape (keep this accurate):**
```
npm run build -w packages/virage-core &&
npm run build -w packages/virage-agent-core &&
npm run build --workspaces --if-present
```

### 7. Version pin consistency when bumping a package version

When a package's version is bumped, update every workspace `package.json` that pins the old fixed version in the **same commit**, then run `npm install` to update `package-lock.json`.

**Trigger:** Any `version` field change in a workspace package's `package.json`.

**Check:**
```bash
grep -r '"@vivantel/<package-name>"' packages/*/package.json
```

If any hit shows a pinned version that doesn't match the new version, update it. npm resolves fixed-version pins against the registry, not the local workspace symlink — a stale pin installs the old published package instead of the workspace copy.

### 8. `type-check:ci` completeness

Every TypeScript package with a `type-check` script must appear in `type-check:ci` in root `package.json`, unless explicitly exempted (e.g., broken third-party type declarations).

**Trigger:** After adding a new package or adding a `type-check` script to an existing package.

**Check:**
```bash
grep -l '"type-check"' packages/*/package.json | sed 's|packages/||; s|/package.json||'
```

Any package in that output not in an exemptions list and not already in `type-check:ci` is a gap — add `-w packages/<name>` to the script.

---

## Active fix sequence

Run these steps in order. Stop and resolve errors before proceeding to the next step.

```bash
# Step 1 — auto-fix lint and formatting issues
npm run fix

# Step 2 — verify formatting is clean per package (catches cases where fix didn't apply,
#           e.g. after git rebase --continue or when only specific packages changed)
npm run format:check --workspaces --if-present

# Step 3 — re-stage fixed files so the commit includes corrections
git add -u

# Step 4 — verify no unfixable lint issues remain
npm run lint

# Step 5 — verify TypeScript across all included packages
npm run type-check:ci
```

Report pass/fail for each step. If any step fails, fix the reported errors before committing — do not suppress with `|| true` or `--no-verify`.

If Step 2 reports a specific package failing, run `npm run format -w packages/<name>` to fix it, then re-run `git add -u` before continuing.

## Structural integrity checks (run after adding packages or bumping versions)

```bash
# a) type-check:ci completeness — compare output against -w list in root package.json
grep -l '"type-check"' packages/*/package.json | sed 's|packages/||; s|/package.json||'

# b) stale version pins after a version bump (substitute actual package name)
# grep -r '"@vivantel/<name>"' packages/*/package.json

# c) build order after adding a new base package
# npm run clean && npm run build:all
```

---

## ESLint configuration summary

File: `eslint.config.js` (flat config, ESLint 8+)

| Rule                                 | Level | Notes                       |
| ------------------------------------ | ----- | --------------------------- |
| `@typescript-eslint/no-explicit-any` | warn  | Prefer typed alternatives   |
| `@typescript-eslint/no-unused-vars`  | error | Prefix with `_` to suppress |
| `no-console`                         | off   | Console output allowed      |
| `no-undef`                           | off   | TypeScript handles this     |

Scope: `packages/virage-core/src/` and `packages/*/src/`

---

## Prettier

Default Prettier config (no `.prettierrc`). Format scope: `packages/*/src/**/*.{ts,tsx}`.

---

## Key npm scripts

| Script                  | What it does                                    |
| ----------------------- | ----------------------------------------------- |
| `npm run fix`           | `lint:fix` + `format` (auto-correct everything) |
| `npm run lint`          | ESLint check only (no changes)                  |
| `npm run format:check`  | Prettier check only (no changes)                |
| `npm run type-check:ci` | TypeScript check across all workspace packages  |
