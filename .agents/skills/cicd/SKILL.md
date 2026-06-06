---
name: cicd
description: Modify CI/CD workflows and release configuration for the Virage monorepo.
license: MIT
metadata:
  author: vivantel-team
  version: "1.0.0"
---

# Skill: CI/CD and Release

**Purpose:** Modify `.github/workflows/` and `.github/config/` to update CI, release, or deployment configuration.

---

## When to use this skill

- Adding or modifying CI/CD workflows in `.github/workflows/`
- Wiring a new package into the release matrix
- Debugging failing CI runs or release jobs
- Changing workflow triggers, secrets, or matrix configuration

---

## Context checklist

```
[ ] List current .github/workflows/ to confirm file names
[ ] Identify which workflow(s) to change
[ ] For release changes: check .release-please-manifest.json for current versions
[ ] Before committing: npm run fix && npm run lint && npm run type-check:ci (see .agents/skills/code-guardian/SKILL.md)
```

---

## Current State — Workflow file map

| File                            | Trigger                      | Purpose                                                                                                   |
| ------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ci.yaml`                       | push/PR to master/develop    | Dynamic matrix: build + test only changed packages                                                        |
| `release.yaml`                  | release-please PR merged     | Publish all packages to npm (OIDC trusted publisher)                                                      |
| `virage-update.yaml`            | push to master               | Run `virage index --config virage.config.ci.json` to reindex the repo using lancedb (no DB secret needed) |
| `automerge-release-please.yaml` | PR labeled by release-please | Auto-approve and merge release PRs after CI passes                                                        |

**Currently published packages in the release matrix** (in sync with `.github/config/release-please.json`):

`virage-core`, `virage-cli`, `virage-dashboard`, `virage-mcp`, `virage-strategies`, `virage-code-chunk-chunker`, `virage-embedder-openai`, `virage-embedder-transformers`, `virage-embedder-fastembed`, `virage-store-postgres`, `virage-store-qdrant`, `virage-store-lancedb`, `virage-store-chromadb`

> **Keep both lists above current.** After adding or removing a package from CI, update this section, then run `.agents/skills/overseer/SKILL.md`.

---

## Adding a new publishable package (4-file checklist)

1. **`.github/config/release-please.json`** — copy any sibling entry under `"packages"`, update the key and `package-name`

2. **`.github/workflows/release.yaml`** — two locations:
   - `outputs:` block → add:
     ```yaml
     <name>: ${{ steps.release.outputs['packages/<name>--release_created'] }}
     ```
   - `strategy.matrix.package:` array → add:
     ```yaml
     - virage-<name>
     ```

3. **`.github/workflows/ci.yaml`** — `filters:` block in the `changes` job: copy a sibling entry, update the package name and path glob

4. **`.release-please-manifest.json`** → add:

   ```json
   "packages/<name>": "<initial-version>"
   ```

5. Update §Current State published packages list above

If the new package has native binary postinstall scripts: add its name to the `contains()` list in the "Install dependencies" step in both `ci.yaml` and `release.yaml`.

---

## Release process

- release-please reads commit messages and generates version bumps automatically
  - `feat:` → minor bump, `fix:` → patch, `feat!:` → major
- The `prepublishOnly` script runs `build && test` before any publish
- Private packages (`virage-store-test`) are excluded from all CI release files

---

## Common tasks

**Add a workflow secret:**

1. GitHub repo → Settings → Secrets → Actions → New secret
2. Reference as `${{ secrets.MY_SECRET }}` in a step `env:` block

**Change a workflow trigger:**
Edit the `on:` block: `push.branches`, `pull_request.branches`, `schedule.cron`, etc.

**Add `--ignore-scripts` for a package with native postinstall:**
Find the "Install dependencies" step in both `ci.yaml` and `release.yaml`; add the package name to the `contains()` conditional.

---

## Validation after CI changes

- Push to a branch → open PR → watch the Actions tab
- Check that the `changes` job output correctly identifies the changed paths
- For `release.yaml` changes: validate with a dry-run PR before merging to master
