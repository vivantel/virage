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

| Prefix | Use for |
|---|---|
| `feat:` | New user-visible feature |
| `fix:` | Bug fix |
| `chore:` | Maintenance, dependency bumps, config |
| `feat!:` / `fix!:` | Breaking change (triggers major version bump) |

**Why:** `release-please` reads commit prefixes to generate changelogs and bump versions automatically.

### 3. Docs-update obligation
After any change affecting developer workflow (new command, new config option, new package, changed pipeline stage), update the relevant `docs/ai/skill-*.md` file in the **same commit**.

Run `skill-overseer.md` checklist to identify which files need updating.

### 4. Architecture-decision obligation
Before implementing any structural change (new abstraction, interface change, storage format change), write an ADR entry in `docs/ADR.md` and get alignment. See `skill-architect.md`.

### 5. Pre-commit hook
`.claude/settings.json` wires a `PreToolUse` hook on `git commit` that runs the full fix sequence automatically. Never bypass with `--no-verify` or `|| true`.

---

## Active fix sequence

Run these steps in order. Stop and resolve errors before proceeding to the next step.

```bash
# Step 1 — auto-fix lint and formatting issues
npm run fix

# Step 2 — re-stage fixed files so the commit includes corrections
git add -u

# Step 3 — verify no unfixable lint issues remain
npm run lint

# Step 4 — verify TypeScript across all included packages
npm run type-check:ci
```

Report pass/fail for each step. If `npm run lint` or `npm run type-check:ci` fails, fix the reported errors before committing — do not suppress with `|| true` or `--no-verify`.

---

## ESLint configuration summary

File: `eslint.config.js` (flat config, ESLint 8+)

| Rule | Level | Notes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | warn | Prefer typed alternatives |
| `@typescript-eslint/no-unused-vars` | error | Prefix with `_` to suppress |
| `no-console` | off | Console output allowed |
| `no-undef` | off | TypeScript handles this |

Scope: `packages/virage-core/src/` and `packages/*/src/`

---

## Prettier

Default Prettier config (no `.prettierrc`). Format scope: `packages/*/src/**/*.{ts,tsx}`.

---

## Key npm scripts

| Script | What it does |
|---|---|
| `npm run fix` | `lint:fix` + `format` (auto-correct everything) |
| `npm run lint` | ESLint check only (no changes) |
| `npm run format:check` | Prettier check only (no changes) |
| `npm run type-check:ci` | TypeScript check across all workspace packages |
