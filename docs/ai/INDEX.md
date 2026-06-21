# Virage AI Agent Index

Load this index before any task. Pick a skill, load it, then execute.

---

## Skills

| I want to…                                        | Load                                          |
| ------------------------------------------------- | --------------------------------------------- |
| Plan, sequence, and track implementation work     | `.agents/skills/planner/SKILL.md`             |
| Write or update user-facing documentation         | `.agents/skills/doc-writer/SKILL.md`          |
| Add / update / develop / test a package           | `.agents/skills/package/SKILL.md`             |
| Modify CI/CD or release config                    | `.agents/skills/devops/SKILL.md`              |
| Keep skill files in sync with codebase            | `.agents/skills/overseer/SKILL.md`            |
| Make or review an architecture decision           | `.agents/skills/architect/SKILL.md`           |
| Set up, run, or debug tests and eval              | `.agents/skills/qa/SKILL.md`                  |
| Enforce code quality, fix lint/format/type errors | `.agents/skills/code-guard/SKILL.md`          |
| Analyze telemetry or diagnose the pipeline        | `.agents/skills/analyst/SKILL.md`             |
| Add, update, or review AI skill files             | `.agents/skills/skill-writer/SKILL.md`        |
| Maintain NOW/NEXT/SPEC docs and detect spec drift | `.agents/skills/spec-writer/SKILL.md`         |

---

## Agent integrations

Four coding agent plugins are supported. `virage init` installs the selected agent packages to `~/.virage/plugins` (global) or `$PROJECT_DIR/.virage/plugins` (local) and runs `configure()` to copy static files from the plugin's `plugin-config/` directory into the project. `BaseAgentPlugin.configure()` is idempotent (content-equality check before overwrite). Run `virage update` to upgrade plugin packages and resync configs.

| Agent | Package | Config directory written |
| ----- | ------- | ------------------------ |
| Claude Code | `@vivantel/virage-agent-claude` | `.claude/skills/virage-agent/` (skills-dir plugin, includes MCP) |
| GitHub Copilot | `@vivantel/virage-agent-copilot` | `.github/copilot/` (hooks.json, instructions/) |
| OpenAI Codex | `@vivantel/virage-agent-codex` | `.codex/` (hooks.json) |
| Google Antigravity | `@vivantel/virage-agent-antigravity` | `.antigravity/` (hooks.json) |

Shared base: `@vivantel/virage-agent-core` — TypeScript types, concrete `BaseAgentPlugin` (static file-copier), `VendorConfig` constants for all 4 vendors. Architecture: ADR-026.

**Claude Code MCP registration** — `virage init` / `virage update` automatically run:
```bash
claude mcp add virage --scope project -- npx -y @vivantel/virage-agent-claude@latest
```
Falls back to direct `.mcp.json` editing when the `claude` CLI is unavailable. The plugin is self-contained: it copies `commands/plan.md` and other files from `plugin-config/` and registers the MCP server.

**Claude Code slash commands** installed by the plugin (`plugin-config/commands/`):

| Command | What it does |
| ------- | ------------ |
| `/plan` | Load and follow the Virage planner skill |
| `/review` | Load and follow the Virage review skill |
| `/rag <query>` | Semantic search via `mcp__virage__search` (requires `virage index` first) |
| `/index [flags]` | Run `virage index` via Bash (supports `--force`, `--dry-run`, `--watch`, etc.) |
| `/doc` | Load and follow the Virage doc-writer skill |
| `/arch` | Load and follow the Virage architect skill |
| `/usage` | Show per-prompt token usage for the current session |

**MCP tools** exposed by the `virage` MCP server (registered via `claude mcp add virage --scope project`):

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
npm run type-check                     # TypeScript check (all packages)
npm run fix                            # ESLint auto-fix + Prettier
npm run lint                           # lint check only
npm test -w @vivantel/<pkg>            # unit tests for one package
npm run build -w @vivantel/<pkg>       # build one package
npm run build:with-dashboard -w @vivantel/virage-cli  # CLI build including dashboard UI
virage init                            # interactive wizard: config, agents, embedder, vector store, re-ranker, hybrid search; installs all plugins to ~/.virage/plugins or $PROJECT_DIR/.virage/plugins
virage update (up)                     # update virage plugins from plugin dirs + node_modules + re-run agent configure + sync skills
virage query (q) "<text>"             # semantic search; prints search mode after banner (--json, --top-k, --branch, --hybrid, --rerank)
virage install-hooks (hooks)           # install post-merge & post-checkout git hooks for auto-indexing
virage dashboard (d) [--verbose]       # start local RAG monitoring dashboard
virage eval (e) run                    # one-shot retrieval quality check
virage eval generate (gen)             # generate eval dataset from indexed chunks
virage eval save --name <n>            # run evaluation and save results for comparison
virage eval list                       # list saved evaluation runs
virage eval compare --baseline --candidate  # bootstrap significance test between two runs
virage eval-suite (es) run --suite eval/suite.json  # multi-config/multi-db eval suite (downloads DB archives, compares all variants)
virage pack --output ./archive.tar.gz  # pack LanceDB dir as a shareable .tar.gz for eval-suite
```

### CLI alias quick-reference

| Command | Alias |
|---------|-------|
| `index` | `i` |
| `update` | `up` |
| `check` | `c` |
| `validate` | `val` |
| `report` | `r` |
| `query` | `q` |
| `dashboard` | `d` |
| `install-hooks` | `hooks` |
| `usage` | `use` |
| `read-skill-summary` | `skill` |
| `eval` | `e` |
| `eval generate` | `eval gen` / `e gen` |
| `eval-suite` | `es` |

---

## Cross-cutting rules

- **Pre-commit**: `.claude/settings.json` hook auto-runs `npm run fix && npm run type-check` before every commit — do not skip (see §Code quality guardrails below)
- **package-lock.json**: any change to a `package.json` (new dep, version bump, new package added) **must** be followed by `npm install` from the repo root before committing; stage the updated `package-lock.json` in the same commit — a stale lock file breaks `npm ci` in CI
- **Module imports**: all internal imports use `.js` extensions (NodeNext requirement), e.g. `from "./foo.js"` even though file is `.ts`
- **Commit messages**: Conventional Commits (`feat:`, `fix:`, `chore:`, `feat!:` for breaking) — drives release-please versioning
- **Docs updates**: after any change affecting developer workflow, update the relevant skill file in the same commit (run overseer skill checklist)
- **Architecture decisions**: record in `docs/ADR.md` before implementing; see architect skill

---

## Code quality guardrails

**Pre-commit fix sequence** (run before every `git add`):

```bash
npm run fix            # lint:fix + prettier --write
npm run lint           # eslint check (read-only)
npm run type-check     # type-check all workspaces
```

Hook: `.claude/settings.json` fires `npm run fix && npm run type-check` automatically before every commit. **Never skip with `--no-verify`.**

**Key npm scripts:**

| Script | What it does |
| ------ | ------------ |
| `npm run fix` | `npm run lint:fix && npm run format` |
| `npm run lint` | `eslint packages/virage-core/src/ packages/*/src/` |
| `npm run lint:fix` | same as `lint` but with `--fix` |
| `npm run format` | `prettier --write "packages/*/src/**/*.{ts,tsx}"` |
| `npm run type-check` | type-check all workspaces |
| `npm run build:all` | build `virage-core` → `virage-agent-core` → all others |
| `npm test` | run tests in all workspaces |

**`type-check:ci` exclusions** (JavaScript or non-TS packages, excluded intentionally):
`virage-dashboard`, `virage-skills`, `virage-store-test`, `virage-mcp`

**Active guardrails:**
1. All internal imports use `.js` extensions (NodeNext — e.g. `from "./foo.js"` for a `.ts` file)
2. Conventional Commits required — drives release-please versioning
3. Update the relevant skill file when developer workflow changes (run overseer skill)
4. Write an ADR before structural changes (run architect skill)
5. Never bypass pre-commit hooks
6. Build order must be respected: `virage-core` → `virage-agent-core` → all others
7. After any `package.json` change: `npm install` from repo root, commit updated `package-lock.json`

---

## Architecture state

**Technology stack:**

| Property | Value |
| -------- | ----- |
| Language | TypeScript |
| Module system | NodeNext |
| Import extensions | `.js` (required even for `.ts` files) |
| TypeScript target | ES2022 |
| Build output | `dist/` (gitignored) |
| Config format | JSON (`virage.config.json`); `chunking.{exclude,chunkers}` structure; `${ENV_VAR}` expansion |

**Pipeline stages** (in order):

| Stage | Class | Responsibility |
| ----- | ----- | -------------- |
| 1 | `GitTracker` | Detect changed files since last run |
| 2 | `ChunkProcessor` | Chunk source files via a `FileChunker` strategy |
| 3 | `EmbedderProcessor` | Embed chunks via an `EmbeddingProvider` |
| 4 | `Uploader` | Upload embeddings to a `VectorStore` |

**Provider interfaces** (`packages/virage-core/src/interfaces/`):

| Interface | Implementations |
| --------- | --------------- |
| `FileChunker` | `virage-code-chunk-chunker`, `virage-strategies` |
| `EmbeddingProvider` | `virage-embedder-openai`, `virage-embedder-fastembed`, `virage-embedder-transformers` |
| `VectorStore` | `virage-store-chromadb`, `virage-store-lancedb`, `virage-store-qdrant`, `virage-store-postgres` |
| `Logger` | built-in console logger in `virage-core` |

**Plugin registry**: packages declare themselves as Virage plugins via `"rag-plugin": "<entrypoint>"` in `package.json`.

**ADR log** (latest — full log in `docs/ADR.md`):

| ADR | Title | Status |
| --- | ----- | ------ |
| ADR-021 | SQLite as intermediate embeddings storage | Accepted |
| ADR-022 | Mid-run partial uploads via `onIntermediateBatch` | Accepted |
| ADR-023 | Fail-fast on fatal vector store errors | Accepted |
| ADR-024 | Split `virage-core` into library + CLI + dashboard | Accepted |
| ADR-025 | Universal agent hook base package (`virage-agent-core`) | Accepted |
| ADR-026 | Static-file copier model for agent plugins | Accepted |
| ADR-027 | `list_skills` response shape — `string[]` → `SkillMeta[]` | Accepted |
| ADR-028 | Branch-aware RAG via metadata tagging | Accepted |
| ADR-029 | No switch to Claude Code native subagents for Virage skills | Accepted |
| ADR-030 | Semver ranges in peerDependencies for inter-package dependencies | Accepted |
| ADR-031 | `chunking` config section with global exclude patterns | Accepted |
| ADR-032 | Scanning/chunking perf + global model dir + GPU support | Accepted |
| ADR-033 | `file_revisions` table for zero-chunk file tracking | Accepted |

---

## Package development

**Package inventory** (21 packages under `@vivantel/`):

| Package | Type | Published |
| ------- | ---- | --------- |
| `virage-core` | Core library + interfaces | Yes |
| `virage-cli` | CLI entrypoint (`virage` command) | Yes |
| `virage-mcp` | MCP server | Yes |
| `virage-dashboard` | Web dashboard (JavaScript) | Yes |
| `virage-strategies` | Built-in chunking strategies | Yes |
| `virage-code-chunk-chunker` | Code chunker plugin | Yes |
| `virage-embedder-openai` | OpenAI embedder | Yes |
| `virage-embedder-fastembed` | FastEmbed embedder | Yes |
| `virage-embedder-transformers` | Transformers.js embedder | Yes |
| `virage-store-chromadb` | ChromaDB store | Yes |
| `virage-store-lancedb` | LanceDB store | Yes |
| `virage-store-qdrant` | Qdrant store | Yes |
| `virage-store-postgres` | PostgreSQL store | Yes |
| `virage-store-test` | Test store stub | No (private) |
| `virage-reranker-cross-encoder` | Cross-encoder reranker | Yes |
| `virage-reranker-llm` | LLM reranker | Yes |
| `virage-agent-core` | Agent plugin base | Yes |
| `virage-agent-claude` | Claude Code plugin | Yes |
| `virage-agent-copilot` | GitHub Copilot plugin | Yes |
| `virage-agent-codex` | OpenAI Codex plugin | Yes |
| `virage-agent-antigravity` | Google Antigravity plugin | Yes |
| `virage-skills` | Agent skill files | Yes |

**Shared TypeScript config** (all published packages):
```json
{ "module": "NodeNext", "moduleResolution": "NodeNext", "target": "ES2022", "outDir": "./dist" }
```

**Workspace development commands:**
```bash
npm run build -w packages/<name>         # build one package
npm run dev -w packages/<name>           # rebuild on change (if script exists)
npm run type-check -w packages/<name>    # type-check one package
npm test -w packages/<name>              # test one package
npm run build:all                        # build all in dependency order
```

---

## CI/CD and release

**Workflow files** (`.github/workflows/`):

| File | Trigger | Purpose |
| ---- | ------- | ------- |
| `ci.yaml` | Push / PR to any branch | Build, type-check, lint, test (path-filtered) |
| `release.yaml` | Push to `master` | release-please version bump + npm publish |
| `automerge-release-please.yaml` | release-please PRs | Auto-merge release PRs |
| `virage-update.yaml` | Push to `master` | Re-index the Virage repo via `virage update` |
| `rag-eval.yml` | Manual / schedule | RAG quality evaluation runs |

**Adding a new publishable package** — update these 4 files:
1. `.release-please-manifest.json` — add `"packages/<name>": "0.1.0"`
2. `release-please-config.json` — add package entry with `"release-type": "node"`
3. `.github/workflows/ci.yaml` — add package to `paths` filter and matrix
4. `.github/workflows/release.yaml` — add publish step for the package

**Release mechanics**: release-please reads Conventional Commit messages to determine version bumps. `prepublishOnly` script runs `npm run build && npm test` before publishing.

---

## Testing infrastructure

**Test commands:**

| Type | Command |
| ---- | ------- |
| Unit (one package) | `npm test -w packages/<name>` |
| All tests | `npm test` |
| Type check | `npm run type-check` |
| Coverage | `npm test -- --coverage -w packages/<name>` |

**Acceptance tests** (E2E):
- Vitest config: `packages/virage-core/vitest.config.acceptance.ts`
- Test dependency: `@vivantel/virage-store-test`
- Required env var: `E2E_CLONE_DIR=<path-to-repo-for-indexing>`

**Eval infrastructure** (RAG quality — source files):
- Generator: `packages/virage-core/src/eval/generator.ts`
- Runner: `packages/virage-core/src/eval/runner.ts`
- RAGAS scorer: `packages/virage-core/src/eval/ragas.ts`
- Chunk quality metrics: `packages/virage-core/src/strategies/chunk/quality-metrics.ts`

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
- Save implementation plans with progress checkboxes to `docs/internal/next_plan.md` (Virage convention; see planner skill for the general format)
