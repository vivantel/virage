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
| `/plan` | Load the Virage planner skill for task breakdown and sequencing |
| `/review` | Load the Virage `code-guard` skill for code review and security audit |
| `/doc` | Load the Virage `doc-writer` skill to write or update documentation |
| `/arch` | Load the Virage `architect` skill for ADR authoring and system design |
| `/quality` | Run `virage quality` pipeline self-assessment and report metrics |
| `/rag <query>` | Semantic search via `mcp__virage__search` (requires `virage index` first) |
| `/index [flags]` | Run `virage index` via Bash (supports `--force`, `--dry-run`, `--watch`, etc.) |
| `/usage` | Show per-prompt token usage for the current session |

**`UserPromptSubmit` hook** — installed by `virage init` into `.claude/settings.json`. On every prompt it:
1. Keyword-matches the prompt to the most relevant skill and outputs a skill summary as context (planner, architect, doc-writer, or code-guard).
2. Automatically runs `virage query <prompt excerpt> --json --top-k 3` and injects the top RAG results as `# Virage RAG Context` into Claude's context window — no explicit `/rag` call needed.

Both steps fail silently if no index is built yet (graceful degradation via `2>/dev/null || true`).

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

**Standalone MCP server** (`@vivantel/virage-mcp`) — a separate package not bundled with the Claude plugin. Start it with:
```bash
virage-mcp --config virage.config.json
```
Exposes a lower-level set of tools (`search`, `list_chunks`, `get_chunk`, `list_source_files`, `get_stats`) suited for non-Claude integrations, custom agents, and programmatic access where you want direct LanceDB access without the skill-routing layer.

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
virage update (up) [-f] [-y]           # update virage plugins; --force reinstalls even at latest; --yes skips interactive selection
virage query (q) "<text>"             # semantic search; prints search mode after banner (--json, --top-k, --branch, --hybrid, --rerank)
virage install-hooks (hooks)           # install post-merge & post-checkout git hooks for auto-indexing
virage uninstall (un) [--yes]          # full cleanup: hooks, plugin dirs, DB, config, global CLI
virage dashboard (d) [--verbose]       # start local RAG monitoring dashboard
virage quality (ql)                    # 26-metric pipeline self-assessment (default action)
virage quality --json                  # machine-readable JSON report
virage quality --fail-fast             # exit 1 on must-pass threshold violation
virage quality --history               # save run to .virage/quality-history/ (benchmark-action format)
virage quality --benchmark <path>      # also run RAGBench evaluation from qrels/JSON
virage quality eval run                # one-shot retrieval quality check
virage quality eval generate (gen)     # generate eval dataset from indexed chunks
virage quality eval save --name <n>    # run evaluation and save results for comparison
virage quality eval list               # list saved evaluation runs
virage quality eval compare --baseline --candidate  # bootstrap significance test between two runs
virage quality suite run --suite eval/suites/retrieval-quality.suite.json  # multi-config/multi-db eval suite
virage quality bench embedder          # benchmark embedder latency (p50/p95/p99)
virage quality bench chunker <files>   # benchmark chunker throughput
virage quality bench reranker          # benchmark reranker latency
virage quality history list            # list saved quality runs
virage quality history show <id>       # show a specific quality run
virage pack --output ./archive.tar.gz  # pack LanceDB dir as a shareable .tar.gz for quality suite
```

### CLI alias quick-reference

| Command | Alias(es) |
|---------|-----------|
| `index` | `i` |
| `update` | `up` |
| `check` | `c` |
| `validate` | `v`, `val` |
| `report` | `r` |
| `query` | `q` |
| `dashboard` | `d` |
| `install-hooks` | `hooks` |
| `uninstall` | `un` |
| `usage` | `use` |
| `read-skill-summary` | `skill` |
| `quality` | `ql` |
| `quality eval` | `quality e` / `ql e` |
| `quality eval generate` | `quality eval gen` |
| `quality suite` | (no alias) |
| `quality bench` | `quality b` |
| `quality bench embedder` | `quality b e` |
| `quality bench chunker` | `quality b c` |
| `quality bench reranker` | `quality b r` |
| `quality history` | `quality hist` |
| `telemetry` | `tm` |

**Quality bench short flags:** `-s / --samples`, `-w / --warmup` (all three subcommands).

**Quality bench chunker** accepts glob patterns and multiple file paths: `virage quality b c 'src/**/*.ts' 'docs/**/*.md' -s 5 -w 1`. Files are routed to chunkers based on each chunker's `include` patterns.

---

## Cross-cutting rules

- **Pre-commit**: `.claude/settings.json` hook auto-runs `npm run fix && npm run type-check` before every commit — do not skip (see §Code quality guardrails below)
- **package-lock.json**: any change to a `package.json` (new dep, version bump, new package added) **must** be followed by `npm install --package-lock-only --ignore-scripts && node scripts/patch-lockfile-stubs.cjs` from the repo root; stage the updated `package-lock.json` in the same commit — a stale lockfile breaks `npm ci` in CI. Use `--package-lock-only` (not a plain `npm install`) to match exactly what the pre-push hook checks
- **Module imports**: all internal imports use `.js` extensions (NodeNext requirement), e.g. `from "./foo.js"` even though file is `.ts`
- **File-path map keys must be POSIX**: `glob()` on Windows returns backslash-separated paths. Any code that builds a `Map<string, …>` keyed by file path must normalize: `f.replace(/\\/g, "/")`. The canonical fix point is `git-tracker.ts` `getAllTrackedFiles()` — never skip this when adding new path-keyed maps upstream of `getChangedFiles()`
- **Commit messages**: Conventional Commits (`feat:`, `fix:`, `chore:`, `feat!:` for breaking) — drives release-please versioning
- **Docs updates**: after any change affecting developer workflow, update the relevant skill file in the same commit (run overseer skill checklist)
- **Architecture decisions**: record in `docs/ADR.md` before implementing; see architect skill

---

## Code quality guardrails

**Pre-commit fix sequence** (run before every `git add`):

```bash
cargo fmt                                        # format Rust (auto-fix)
cargo clippy --workspace -- -D warnings          # Rust lint — warnings are errors
npm run fix            # lint:fix + prettier --write (root)
npm run lint           # eslint check — .ts files only (root)
npm run type-check     # type-check all workspaces
```

Hook: `.claude/settings.json` fires automatically before every commit. When `.rs` or `.toml` files are staged it runs `cargo fmt && cargo clippy --workspace -- -D warnings` first; then always runs `npm run fix && npm run type-check`. **Never skip with `--no-verify`.**

**⚠️ Root lint misses `.tsx` files.** The root `lint` glob is `packages/*/src/**/*.ts` — `.tsx` is excluded. For any package that has `.tsx` source files, also run the per-package lint before committing:

```bash
npm run lint --workspace packages/<name> --if-present
```

Packages with `.tsx` files: `virage-dashboard`. Add to this list if new packages introduce `.tsx`.

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
| `npm run rust:fmt` | `cargo fmt` — format all Rust source |
| `npm run rust:lint` | `cargo clippy --workspace -- -D warnings` |
| `npm run rust:fix` | `cargo fmt && cargo clippy --workspace -- -D warnings` |

**`type-check:ci` exclusions** (JavaScript or non-TS packages, excluded intentionally):
`virage-dashboard`, `virage-skills`, `virage-store-test`, `virage-mcp`

**Active guardrails:**
1. All internal imports use `.js` extensions (NodeNext — e.g. `from "./foo.js"` for a `.ts` file)
2. Conventional Commits required — drives release-please versioning
3. Update the relevant skill file when developer workflow changes (run overseer skill)
4. Write an ADR before structural changes (run architect skill)
5. Never bypass pre-commit hooks
6. Build order must be respected: `virage-core` → `virage-agent-core` → all others
7. After any `package.json` change: `npm install --package-lock-only --ignore-scripts && node scripts/patch-lockfile-stubs.cjs` from repo root, commit updated `package-lock.json`
8. After any `.rs` or `Cargo.toml` change: run `npm run rust:fix` before committing — clippy warnings are treated as errors (`-D warnings`)

**CE chunker package guardrails** (applies to `packages/virage-chunker-ce-*`):
- See [`guardrails/chunker.md`](guardrails/chunker.md) — plugin contract, ArtifactChunker interface, ChunkMeta fields
- See [`guardrails/rust-napi.md`](guardrails/rust-napi.md) — napi-rs patterns, virage-vidoc usage, build steps
- See [`guardrails/release-ce.md`](guardrails/release-ce.md) — CE publishing process, platform stubs, version bumping
- See [`guardrails/native-publish-chain.md`](guardrails/native-publish-chain.md) — workflow chain invariants, patcher spread trap, production feature flags, race condition coverage, debug guide

**Dashboard guardrails** (applies to `packages/virage-dashboard/` and `packages/virage-cli/src/cli/dashboard.ts`):
- See [`guardrails/dashboard.md`](guardrails/dashboard.md) — data sources (LanceDB vs SQLite), PipelineLog op-filtering, WebSocket conventions, SearchResult fields, testing patterns

**CLI command docs** (`docs/cli/`):
- User-facing reference for every `virage <command>`. When adding a CLI flag or new command, update `docs/cli/<command>.md` in the same commit.
- See [`guardrails/cli/command-docs.md`](guardrails/cli/command-docs.md) for the template and maintenance rules.

**Config schema guardrails** (applies when changing `VirageConfigJson`, `ZodVirageConfig`, or `virage.config.schema.json`):
- See [`guardrails/config-schema.md`](guardrails/config-schema.md) — providers + fileSets schema, tag vocabulary, update checklist (ADR-041/043/046)
- Full user-facing config reference: [`docs/cli/config.md`](../../docs/cli/config.md)

**Plugin schema guardrails** (applies when adding or modifying plugin options):
- See [`guardrails/plugin-schema.md`](guardrails/plugin-schema.md) — optionsSchema export convention, required vs optional fields, PluginOptions type (ADR-047)

**Database migration guardrails** (applies when changing `VirageDb` schema):
- See [`guardrails/virage-db.md`](guardrails/virage-db.md) — MIGRATIONS array, forward-only, deprecated entities, ADD COLUMN IF NOT EXISTS (ADR-042)

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
| Config format | JSON (`virage.config.json`); `providers` + `fileSets` structure (V2, ADR-041/043); `${ENV_VAR}` expansion |

**Pipeline stages** (in order):

| Stage | Class | Responsibility |
| ----- | ----- | -------------- |
| 1 | `GitTracker` | Detect changed files since last run |
| 2 | `ChunkProcessor` | Chunk source files via all matching `ChunkerEntry[]`; inject tags from fileSet.tags + fileSet.tagRules |
| 3 | `EmbedderProcessor` | Embed chunks via an `EmbeddingProvider` |
| 4 | `Uploader` | Upload embeddings to a `VectorStore` |

**Tag pipeline** (`virage-core/src/core/tag-pipeline.ts`) — runs inside `ChunkProcessor` per file (ADR-046):

| Source | Example tags |
| ------ | ------------ |
| `fileSets[].tags` (direct injection) | `"lang:typescript"`, `"format:markdown"` |
| `fileSets[].tagRules` (glob-based) | `{ match: "src/payments/**", add: ["team:payments", "pci-scope"] }` |

**Provider interfaces** (`packages/virage-core/src/interfaces/`):

| Interface | Implementations |
| --------- | --------------- |
| `FileChunker` | `virage-code-chunk-chunker`, external plugins (`virage-chunker-ce-*`, `virage-chunker-ee-*`) |
| `EmbeddingProvider` | `virage-embedder-openai`, `virage-embedder-fastembed`, `virage-embedder-transformers` |
| `VectorStore` | `virage-store-chromadb`, `virage-store-lancedb`, `virage-store-qdrant`, `virage-store-postgres` |
| `SourceRepository` | `CliGitSourceRepository` |
| `SourceProvider` | `CliGitSourceRepository` (also satisfies `SourceRepository`); EE: `virage-source-ee-s3`, `virage-source-ee-gcs`, etc. |
| `Logger` | built-in console logger in `virage-core` |

`SourceProvider` extends `SourceRepository` with `name: string`, `type: string`, and `listAll(filter?: SourceFilter): AsyncIterable<SourceItem>`. `SourceItem` carries `{ id, path, providerName, tags: string[], meta? }` — tags from the provider (e.g. S3 object tags) are merged with fileSet tags at index time.

**`FileChunker` interface** (all chunker plugins must implement):
```typescript
interface FileChunker {
  name: string;                    // package name
  version: string;                 // semver string
  patterns: string[];              // glob patterns
  sparseTextGeneratorId: string;   // per-chunk method fingerprint for sparseText (ADR-037)
  metadataGeneratorId: string;     // per-chunk method fingerprint for metadata (ADR-037)
  chunk(filePath: string, commitHash: string): Promise<Chunk[]>;
  canProcess?(filePath: string): Promise<boolean>;
}
```

**`Chunk` shape** (output of `FileChunker.chunk()`):
```typescript
interface Chunk {
  denseText: string;               // breadcrumb + full body → embedding target
  sparseText: string;              // raw body, no breadcrumb → BM25/FTS
  // contextText is NOT stored — assembled at query time from denseText + metadata.parentId/siblingIds (ADR-036)
  denseTextHash: string;           // sha256(denseText).slice(0,16) — primary dedup key
  sparseTextGeneratorId: string;   // method fingerprint for sparseText generation
  metadataGeneratorId: string;     // method fingerprint for metadata assembly
  metadata: ChunkMeta;             // includes labels?: string[] injected by label pipeline
  sourceFile: string;
  commitHash: string;
}
```

**`SearchOptions`** (passed to `VectorStore.search()`):
```typescript
interface SearchOptions {
  hybrid?: boolean;
  hybridAlpha?: number;
  queryText?: string;
  labelFilter?: string[];   // RBAC: only return chunks whose labels intersect this set
}
```
`labelFilter` is applied post-retrieval in v1 (all 4 stores: fetch `topK × 4`, filter, return `topK`). Phase 4 will move this to a native store-level WHERE clause.
```

**Plugin registry**: packages declare themselves as Virage plugins via `"rag-plugin": "<entrypoint>"` in `package.json`.

See [docs/decisions/INDEX.md](../decisions/INDEX.md) for the full ADR log.

---

## Package development

**Package inventory** (21 packages under `@vivantel/`):

| Package | Type | Published |
| ------- | ---- | --------- |
| `virage-core` | Core library + interfaces | Yes |
| `virage-cli` | CLI entrypoint (`virage` command) | Yes |
| `virage-mcp` | MCP server | Yes |
| `virage-dashboard` | Web dashboard (JavaScript) | Yes |
| `virage-code-chunk-chunker` | Code chunker plugin (legacy JS) | Yes |
| `virage-chunker-ce-ast` | ViDoc AST walker + `createNativeChunker` factory | Yes |
| `virage-chunker-ce-md` | Markdown/MDX chunker (Rust, comrak) | Yes |
| `virage-chunker-ce-pdf` | PDF chunker (Rust, lopdf) | Yes |
| `virage-chunker-ce-docx` | DOCX chunker (Rust) | Yes |
| `virage-chunker-ce-latex` | LaTeX chunker (Rust) | Yes |
| `virage-chunker-ce-lang` | Multi-language code chunker (Rust, tree-sitter 0.23) | Scaffold — not yet published |
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

**CE chunker guardrails:** see [`guardrails/chunker.md`](guardrails/chunker.md) and [`guardrails/rust-napi.md`](guardrails/rust-napi.md). `virage-chunker-ce-lang` differs from document chunkers: it takes a file path (not a buffer) and returns `ParseResult { tree, hash, size, modified_ms }` — see rust-napi guardrail for the pattern.

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
| `virage-index-pipeline.yaml` | Push to `master` | Re-index the Virage repo via `virage index --config virage.config.ci.json` |
| `rag-eval.yml` | Manual / schedule | RAG quality evaluation runs |

**Adding a new publishable package** — update these 4 files:
1. `.release-please-manifest.json` — add `"packages/<name>": "0.1.0"`
2. `release-please-config.json` — add package entry with `"release-type": "node"`
3. `.github/workflows/ci.yaml` — add package to `paths` filter and matrix
4. `.github/workflows/release.yaml` — add publish step for the package

**CRITICAL — after any `package.json` change (new deps, new package, version bump):**
Run `npm install --package-lock-only --ignore-scripts && node scripts/patch-lockfile-stubs.cjs` from the repo root and stage the updated `package-lock.json` in the same commit. A stale lockfile breaks `npm ci` in CI and causes every job to fail with "package.json and package-lock.json are not in sync". Use `--package-lock-only` (not plain `npm install`) — the pre-push hook uses the same flags, so this prevents the hook from finding drift at push time.

**If the pre-push hook still catches lockfile drift** (e.g. a release-please merge landed mid-session), run the same two commands, then **amend the most recent commit if it is already a `chore: sync package-lock.json [skip ci]`** rather than creating a second lockfile-only commit:
```sh
npm install --package-lock-only --ignore-scripts && node scripts/patch-lockfile-stubs.cjs
git add package-lock.json
git commit --amend --no-edit
```

**Adding a native Rust napi-rs package** — checklist (in addition to the above):

| Step | What to do |
|------|-----------|
| `Cargo.toml` (workspace) | Add `"packages/<name>"` to `members` array |
| `Cargo.toml` (package) | `crate-type = ["cdylib"]`; `ort` or heavy C deps: use `load-dynamic` default + `download-binaries` feature; `napi-build` in `[build-dependencies]` |
| `build.rs` | Standard napi: `napi_build::setup()` |
| `npm/` stubs | Create `npm/linux-x64-gnu/`, `linux-arm64-gnu/`, `darwin-x64/`, `darwin-arm64/`, `win32-x64-msvc/` each with `package.json` at version matching the package |
| `package.json` | `optionalDependencies` pointing to each stub at the same version; **then regenerate lockfile** |
| `release-please.json` | Add `extra-files` entries to keep stub `$.version` and `$.optionalDependencies[*]` in sync on every release |
| `release.yaml` | Add to `detect-ce-native` pkgs list; add output to `release-please` job; add to `build-ce-native` (handles the build + upload automatically); verify publish in `publish-ce-native` |
| `ci.yaml` | Add to the `rust-filter` paths-filter step (`changes` job) so Rust changes gate `rust-checks` and `build-ce-native`. If the package uses `ort/download-binaries` or other Cargo features at build time, add a `cargo-features` matrix `include` entry: `{ package: <name>, cargo-features: "--features download-binaries" }` — CI and release build steps use `${{ matrix.cargo-features }}` (no bash `[[...]]` — breaks on Windows). |
| Lockfile | After setting up all `package.json` files, run `npm install --package-lock-only --ignore-scripts` and commit the result |

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
