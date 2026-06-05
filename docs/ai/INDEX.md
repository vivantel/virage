# Virage AI Agent Index

Load this index before any task. Pick a skill, load it, then execute.

---

## Skills

| I want to… | Load |
|---|---|
| Plan, sequence, and track implementation work | `docs/ai/skill-planner.md` |
| Maintain root README.md | `docs/ai/skill-readme.md` |
| Add / update / develop / test a package | `docs/ai/skill-package.md` |
| Modify CI/CD or release config | `docs/ai/skill-cicd.md` |
| Keep docs/ai/ skills in sync with codebase | `docs/ai/skill-overseer.md` |
| Make or review an architecture decision | `docs/ai/skill-architect.md` |
| Set up, run, or debug tests and eval | `docs/ai/skill-qa.md` |
| Enforce code quality, fix lint/format/type errors | `docs/ai/skill-code-guardian.md` |
| Analyze telemetry or diagnose the pipeline | `docs/ai/skill-analyst.md` |

---

## Essential commands

```bash
npm run build:all                      # build all packages
npm run type-check:ci                  # TypeScript check (all included packages)
npm run fix                            # ESLint auto-fix + Prettier
npm run lint                           # lint check only
npm test -w @vivantel/<pkg>            # unit tests for one package
npm run build -w @vivantel/<pkg>       # build one package
npm run build:with-dashboard -w @vivantel/virage-cli  # CLI build including dashboard UI
```

---

## Cross-cutting rules

- **Pre-commit**: `.claude/settings.json` hook auto-runs `npm run fix && npm run lint && npm run type-check:ci` before every commit — do not skip
- **Module imports**: all internal imports use `.js` extensions (NodeNext requirement), e.g. `from "./foo.js"` even though file is `.ts`
- **Commit messages**: Conventional Commits (`feat:`, `fix:`, `chore:`, `feat!:` for breaking) — drives release-please versioning
- **Docs updates**: after any change affecting developer workflow, update the relevant skill file in the same commit (run `skill-overseer.md` checklist)
- **Architecture decisions**: record in `docs/ADR.md` before implementing; see `skill-architect.md`

---

## Memory pointers

| Slug | Tracks |
|---|---|
| `project_streaming_pipeline.md` | Current in-flight features and decisions |
| `project_monorepo_packages.md` | Package inventory and key architectural choices |
| `feedback_pre_commit_fix.md` | Pre-commit enforcement rule |

---

## Planning rules

- Execute steps in dependency order, not in parallel
- Wait for each step to complete before starting the next
- Save implementation plans with progress checkboxes to `docs/internal/next_plan.md`
