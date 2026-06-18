---
name: package
description: Add, update, develop, sync, and test packages in a monorepo.
license: MIT
when_to_use:
  - "Adding a new package to the monorepo"
  - "Updating a package's dependencies or version"
  - "Developing a new plugin or provider implementation"
  - "Syncing package configuration across packages after an interface change"
prerequisites: []
estimated_tokens: 1100
output_format: "New or updated package files with correct workspace wiring and configuration"
companions: [devops, qa]
metadata:
  author: vivantel-team
  version: "2.0.0"
---

# Skill: Package Lifecycle

**Purpose:** Add, update, develop, sync, and test packages in the monorepo.

---

## Role

**Library Maintainer** — owns a package's health from creation through active use.

Responsibilities:
- Manage the full lifecycle of a package: scaffold, dependencies, build, publish, deprecate
- Keep the dependency graph safe: audit dependency versions for known vulnerabilities, don't bump blindly
- Keep the API surface intentional and minimal: every export is a commitment
- Ensure every published package meets quality standards — built, typed, tested, documented — before it ships
- Maintain consistency across the monorepo: shared config, build targets, runtime requirements

---

## When to use this skill

- Adding a new package to the monorepo
- Updating dependencies or publishing config in an existing package
- Building, type-checking, or running tests for a specific package
- Syncing shared config across packages

---

## Context checklist

1. Identify which operation: Add / Update / Develop / Sync / Test
2. For current package inventory: `mcp__virage__search("package workspace published private inventory", top_k=5)` or read `docs/ai/INDEX.md` §Package inventory

```
[ ] Run pre-commit quality checks before staging (see code-guard skill + INDEX.md §Code quality guardrails)
```

---

## Decision tree

```
What are you doing?
├── New package              → §Add
├── Dep or version change    → §Update
├── Writing + building code  → §Develop
├── Syncing shared config    → §Sync
└── Running tests only       → §Test (or load qa skill)
```

---

## Published package required fields

Every published package manifest must have:

| Field | Value |
| ----- | ----- |
| `author` | Package author or org name |
| `license` | `"MIT"` (or your project's license) |
| `keywords` | Domain-relevant terms for discoverability |
| `repository` | `{ "type": "git", "url": "...", "directory": "packages/<name>" }` |
| `engines` | Minimum runtime version requirement |
| `publishConfig` | `{ "access": "public" }` for public packages |
| `files` | Must include `"README.md"` alongside output dir |
| `prepublishOnly` | At minimum `"<build command>"` |

---

## §Add — New package scaffold

1. Create `packages/<name>/src/`
2. Create `packages/<name>/package.json` — all required fields above; set module type to match project convention (see `docs/ai/INDEX.md` §Architecture state)
3. Copy build config (tsconfig.json or equivalent) from a sibling package matching your build target
4. Create `src/index.<ext>` (exports) and `README.md` (badges, description, install, usage)
5. Wire release automation — see `devops` skill
6. Wire CI workflows — see `devops` skill and `docs/ai/INDEX.md` §CI/CD and release state
7. Add `-w packages/<name>` (or equivalent) to the type-check command in root config
8. Update package inventory in `docs/ai/INDEX.md` §Package inventory
9. Update `devops` skill if the new package is publishable
10. Install dependencies from repo root to link workspace and update the lock file.
    **Stop if install fails** — do not proceed to later steps until it completes successfully.
11. Verify lock file integrity: run the dry-run install check for your package manager
12. Run type-check and build for the new package — both must pass
13. Run `overseer` skill reactive checklist

---

## §Update — Existing package changes

- **Dep bump**: before bumping a dependency, check for known vulnerabilities in the current version — don't bump blindly, verify what changed between versions. Then: update manifest → install → type-check → test
- **Interface change**: search all workspace packages for the changed import before committing
- **CLI command changed**: update `docs/ai/INDEX.md` §Essential commands if commonly used
- **Version bump**: update every workspace package that pins the old version in the same commit, then re-run install to update the lock file

---

## §Develop — Build loop

1. Build the package
2. Run type-check (type-only is faster for iteration)
3. Run tests
4. Repeat from step 1 until all checks pass

**API surface discipline:** New exports must be listed in `package.json` `files` and documented in the package README before they ship. An export not in the manifest is not part of the public API. An undocumented export is a maintenance liability.

> For project-specific build commands: see `docs/ai/INDEX.md` §Package development.

---

## §Sync — Shared config across packages

Items to keep consistent across all packages:

| Config | What to check |
| ------ | ------------- |
| Build config | Module system, resolution, and compilation target |
| Linting config | Inherited from root config |
| Runtime version requirement | Minimum version in engine field |

> For this project's specific config values: see `docs/ai/INDEX.md` §Architecture state.

---

## §Test — Running tests

See `qa` skill for the full test strategy. Quick reference: run unit tests, acceptance tests, and type-check before any commit.

> For this project's specific test commands: see `docs/ai/INDEX.md` §Testing infrastructure.
