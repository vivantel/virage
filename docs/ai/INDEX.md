# Virage AI Agent Index

Load this index before any task. Pick a skill, load it, then execute.

---

## Skills

| I want to…                                        | Load                                          |
| ------------------------------------------------- | --------------------------------------------- |
| Plan, sequence, and track implementation work     | `.agents/skills/planner/SKILL.md`             |
| Write or update user-facing documentation         | `.agents/skills/doc_writer/SKILL.md`          |
| Add / update / develop / test a package           | `.agents/skills/package/SKILL.md`             |
| Modify CI/CD or release config                    | `.agents/skills/devops/SKILL.md`                |
| Keep skill files in sync with codebase            | `.agents/skills/overseer/SKILL.md`            |
| Make or review an architecture decision           | `.agents/skills/architect/SKILL.md`           |
| Set up, run, or debug tests and eval              | `.agents/skills/qa/SKILL.md`                  |
| Enforce code quality, fix lint/format/type errors | `.agents/skills/code-guardian/SKILL.md`       |
| Analyze telemetry or diagnose the pipeline        | `.agents/skills/analyst/SKILL.md`             |
| Add, update, or review AI skill files             | `.agents/skills/skill-guru/SKILL.md`          |

---

## Agent integrations

Four coding agent plugins are supported. Each installs via `virage init` and copies hand-authored static files from the plugin's `plugin-config/` directory into the project. `BaseAgentPlugin.configure()` handles the recursive copy with content-comparison (idempotent). Run `virage update` to re-apply configs after upgrading plugin packages.

| Agent | Package | Config directory written |
| ----- | ------- | ------------------------ |
| Claude Code | `@vivantel/virage-agent-claude` | `.claude/skills/virage-agent/` (skills-dir plugin, includes MCP) — or install via `virage-agent@vivantel` marketplace |
| GitHub Copilot | `@vivantel/virage-agent-copilot` | `.github/copilot/` (hooks.json, instructions/) |
| OpenAI Codex | `@vivantel/virage-agent-codex` | `.codex/` (hooks.json) |
| Google Antigravity | `@vivantel/virage-agent-antigravity` | `.antigravity/` (hooks.json) |

Shared base: `@vivantel/virage-agent-core` — TypeScript types, concrete `BaseAgentPlugin` (static file-copier), `VendorConfig` constants for all 4 vendors. Architecture: ADR-026.

**Claude Code marketplace install** (alternative to `virage init`):
```bash
claude plugin marketplace add vivantel/virage --scope project
claude plugin install virage-agent@vivantel --scope project
```
The marketplace manifest is at `.claude-plugin/marketplace.json` in the repo root. The plugin source is `packages/virage-agent-claude/plugin-config` (sparse-cloned via `git-subdir`). The plugin is self-contained: it declares `commands/plan.md` and an MCP server via `.mcp.json`.

**Claude Code slash commands** installed by the plugin (`plugin-config/commands/`):

| Command | What it does |
| ------- | ------------ |
| `/plan` | Load and follow the Virage planner skill |
| `/review` | Load and follow the Virage review skill |
| `/rag <query>` | Semantic search via `mcp__virage__search` (requires `virage index` first) |
| `/index [flags]` | Run `virage index` via Bash (supports `--force`, `--dry-run`, `--watch`, etc.) |
| `/doc` | Load and follow the Virage doc_writer skill |
| `/arch` | Load and follow the Virage architect skill |
| `/usage` | Show per-prompt token usage for the current session |

**MCP tools** exposed by the `virage` MCP server (registered in `.mcp.json`):

| Tool | Purpose |
| ---- | ------- |
| `mcp__virage__list_skills` | List all skills with structured metadata (single round-trip routing) |
| `mcp__virage__read_skill_summary` | Read ≤20-line skill summary before committing to full load |
| `mcp__virage__read_skill` | Read full `SKILL.md` content |
| `mcp__virage__suggest_skill` | Keyword-match a task description to the best-fit skill |
| `mcp__virage__search` | Semantic search over the indexed knowledge base (spawns `virage query --json`) |
| `mcp__virage__onboard` | Self-configure Claude Code hooks and MCP registration |
| `mcp__virage__session_usage` | Parse session log for per-prompt token breakdown |

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
virage init                            # interactive wizard: config, agents, embedder, vector store
virage update                          # update virage ecosystem packages + re-run plugin configure
virage query "<text>"                  # semantic search over the indexed knowledge base (--json, --top-k, --branch)
virage install-hooks                   # install post-merge & post-checkout git hooks for auto-indexing
```

---

## Cross-cutting rules

- **Pre-commit**: `.claude/settings.json` hook auto-runs `npm run fix && npm run lint && npm run type-check:ci` before every commit — do not skip
- **package-lock.json**: any change to a `package.json` (new dep, version bump, new package added) **must** be followed by `npm install` from the repo root before committing; stage the updated `package-lock.json` in the same commit — a stale lock file breaks `npm ci` in CI
- **Module imports**: all internal imports use `.js` extensions (NodeNext requirement), e.g. `from "./foo.js"` even though file is `.ts`
- **Commit messages**: Conventional Commits (`feat:`, `fix:`, `chore:`, `feat!:` for breaking) — drives release-please versioning
- **Docs updates**: after any change affecting developer workflow, update the relevant skill file in the same commit (run `.agents/skills/overseer/SKILL.md` checklist)
- **Architecture decisions**: record in `docs/ADR.md` before implementing; see `skill-architect.md`

---

## Key reference docs

| Doc | Purpose |
|-----|---------|
| `docs/USE_CASES.md` | Concrete end-to-end scenarios with commands and measurable outcomes |
| `docs/ROADMAP.md` | Critical gap analysis + planned features with rationale and eval targets |
| `docs/ADR.md` | Architecture decision records (read before proposing structural changes) |

---

## Memory pointers

| Slug                            | Tracks                                          |
| ------------------------------- | ----------------------------------------------- |
| `project_streaming_pipeline.md` | Current in-flight features and decisions        |
| `project_monorepo_packages.md`  | Package inventory and key architectural choices |
| `feedback_pre_commit_fix.md`    | Pre-commit enforcement rule                     |

---

## Planning rules

- Execute steps in dependency order, not in parallel
- Wait for each step to complete before starting the next
- Save implementation plans with progress checkboxes to `docs/internal/next_plan.md`
