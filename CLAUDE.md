# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Maintaining this file

**Claude must keep CLAUDE.md current.** After any change that affects developer workflow, update this file in the same PR/commit as the feature — not after. The goal is that a developer (or Claude in a future session) can open CLAUDE.md and immediately understand the current system without reading the source.

- New package added → add it to the Monorepo overview
- New CLI subcommand → add it to the CLI section
- Pipeline stage changed (storage format, flags, default paths) → update Pipeline stages
- New interface or major type → update Interfaces
- New test configuration or npm script → update Commands
- New architectural subsystem → add or update its section
- Architecture decision made (new storage engine, changed default paths, new subsystem design) → record it in `docs/ADR.md` and reference the ADR number in relevant commit messages or code comments. Before making a significant design decision, check `docs/ADR.md` to see if the trade-off was already evaluated.

## Commands

Root-level (run from repo root, operate across all workspaces):

```bash
npm run build:all      # build all workspace packages
npm run fix            # ESLint auto-fix + Prettier across all packages
npm run lint           # ESLint (read-only check)
npm run type-check:ci  # TypeScript check on packages with working type files
npm run clean          # rm -rf all dist/ and node_modules
```

Per-package commands (run from `packages/virage-core/` or via `npm run X -w @vivantel/virage-core`):

```bash
npm run build          # compile TypeScript to dist/
npm run build:clean    # rm -rf dist && build (alias: build)
npm test               # run all unit tests
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
npm run test:acceptance  # build virage-store-test then run acceptance suite
npm run docs:generate  # TypeDoc HTML documentation
npm run type-check     # tsc --noEmit
npm run lint           # ESLint
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier write
npm run format:check   # Prettier check
npm run check:quick    # type-check + lint
npm run check:full     # type-check + lint + format + tests + type-coverage
```

Run a single test file:
```bash
npx vitest run src/core/git-tracker.test.ts
```

## Architecture

This is an ESM TypeScript monorepo (`type: module`, NodeNext module resolution). The primary published package is `@vivantel/virage-core`. It provides a four-stage RAG pipeline that consumers wire together via a JSON config file.

### Monorepo packages (`packages/`)

| Package | Published | Purpose |
|---|---|---|
| `virage-core` | yes | Pipeline engine, interfaces, strategies, eval, telemetry — **no CLI deps** |
| `virage-cli` | yes | `virage` binary + all CLI commands; depends on virage-core. Use `build:with-dashboard` for a complete local build (embeds dashboard UI). |
| `virage-dashboard` | yes | React + Vite dashboard web app served by `virage dashboard`; publishes `dist/` to npm and is embedded in virage-cli at build time. Supports multi-project switching and persists recent projects to `~/.virage/recent-projects.json`. |
| `virage-strategies` | yes | Re-exports built-in chunk strategies as a standalone install |
| `virage-embedder-fastembed` | yes | Local FastEmbed embeddings |
| `virage-embedder-openai` | yes | OpenAI embeddings + semantic cache + judge |
| `virage-embedder-transformers` | yes | HuggingFace Transformers embeddings |
| `virage-store-postgres` | yes | pgvector vector store |
| `virage-store-qdrant` | yes | Qdrant vector store |
| `virage-store-lancedb` | yes | LanceDB vector store |
| `virage-store-chromadb` | yes | ChromaDB vector store |
| `virage-store-test` | no (private) | File-backed mock VectorStore for acceptance testing |

### Published package checklist

Every published package must include these `package.json` fields:

| Field | Value / example |
|---|---|
| `author` | `"Vivantel"` |
| `license` | `"MIT"` |
| `keywords` | RAG-related terms + package-specific terms |
| `repository` | `{ "type": "git", "url": "https://github.com/vivantel/virage", "directory": "packages/<name>" }` |
| `engines` | `{ "node": ">=18.0.0" }` |
| `publishConfig` | `{ "access": "public" }` |
| `files` | Must include `"README.md"` alongside output dir |
| `prepublishOnly` | At minimum `"npm run build"` |

Required scripts: `lint`, `lint:fix`, `format`, `format:check`, `fix` (matching pattern of sibling packages).

Required files: `README.md` (badges, description, install/usage).

Packages that are web apps (not Node.js libraries) omit `main`, `types`, and `exports`.

### Pipeline stages (all in `src/core/`)

1. **GitTracker** — uses `simple-git` + `glob` to find files matching chunker patterns, computes per-file commit hashes for change detection. Appends `-dirty` to hashes when there are uncommitted changes.

2. **ChunkProcessor** — runs each file through its matched `FileChunker`, adds `contentHash` (SHA-256 first 16 chars) to each chunk. The orchestrator atomically replaces old chunk rows in the DB with new ones (`replaceChunks()`), so the DB is always consistent.

3. **EmbedderProcessor** — provides `embedChunks(chunks)` for batch embedding with automatic sub-batching by `batchSize` and `maxBatchChars`. The orchestrator calls this when the pending-embed queue reaches `minEmbeddingBatchSize`.

4. **Uploader** — `prepareUpdate()` deletes stale vector store entries before the chunking loop; `upsertBatch()` uploads a batch, marks chunks uploaded, and clears the `embedding` BLOB from the DB to reclaim storage. Fatal vector store errors are detected by `isFatalVectorStoreError()`.

**Orchestrator** (`packages/virage-core/src/core/orchestrator.ts`) runs a single streaming loop: chunk → embed → upload interleave as batches accumulate. Default artifact directory is `.virage/` (overridable via `VIRAGE_DIR` env var or CLI flags).

Pipeline config batch sizes (`RAGPipelineConfig.options`):
- `minEmbeddingBatchSize` (default 10): trigger embedding when this many chunks are pending
- `minUploadingBatchSize` (default 20): trigger upload when this many embeddings are pending

Progress reporting is callback-based: `RAGPipelineConfig.options` accepts `onChunkProgress`, `onEmbedProgress`, `onUploadProgress` callbacks. The CLI creates all three progress bars at pipeline start; totals for embed/upload grow dynamically via `setTotal()` as chunks are discovered.

### Interfaces (`src/interfaces/`)

Provider interfaces consumers must implement:
- `FileChunker` — `chunk(filePath, commitHash): Promise<Chunk[]>` plus `patterns: string[]`
- `EmbeddingProvider` — `embed(text): Promise<number[]>`, optional `embedBatch`
- `VectorStore` — `initialize`, `upsert`, `deleteBySourceFile`, `getCurrentState`, `search`
- `Logger` — `debug/info/warn/error(msg)` methods; see Logger section below

Quality/observability types in `src/interfaces/quality.ts`:
`ChunkQualityMetrics`, `EmbeddingMetrics`, `IndexStats`, `QueryPerfReport`, `EvalResult`, `RAGASResult`, `ExperimentRun` — consumed by eval, experiment, and store-diagnostics commands.

### Strategies (`src/strategies/chunk/`)

Four built-in `ChunkStrategy` implementations returned as factory functions: `tokenStrategy`, `markdownHeadersStrategy`, `semanticStrategy`, `wholeFileStrategy`. Strategies produce `Chunk[]` from raw text; they are lower-level than `FileChunker` — use `createChunker` to compose them.

`ChunkStrategy` has an optional `getQualityMetrics?(chunks: Chunk[]): ChunkQualityMetrics` hook. `computeChunkQualityMetrics()` in `src/strategies/chunk/quality-metrics.ts` provides a standalone implementation usable without a full strategy instance.

### `createChunker` helper (`src/helpers/create-chunker.ts`)

Wraps the `FileChunker` interface. Two usage styles, enforced by a TypeScript discriminated union:

- **Strategy shorthand** (common case): pass `strategy: ChunkStrategy` and optional `name`. Name auto-derives as `"${strategy.name}:${patterns[0]}"` if omitted.
  ```typescript
  createChunker({ patterns: ["docs/**/*.md"], strategy: markdownHeadersStrategy() })
  ```
- **Custom process** (advanced): pass `process(content, filePath, commitHash)` and a required `name`. Gives full control over chunking logic.
  ```typescript
  createChunker({ name: "custom", patterns: ["**/*.txt"], process: async (content) => [...] })
  ```

`canProcess` is optional on both paths.

### CLI (`packages/virage-cli/src/bin/virage.ts`)

The `virage` binary is provided by `@vivantel/virage-cli`. Install that package (not `@vivantel/virage-core`) to get the CLI.

Bare `virage` prints help. All actions require a subcommand.

**Primary pipeline command:**
```
virage update                    # run the RAG indexing pipeline
  -c, --config <path>            # config file path (default: ./virage.config.json)
  -f, --force                    # force full rebuild
  --no-upload                    # skip upload to vector store
  --dry-run                      # show what would change without uploading
  --embeddings-out <path>        # override output path for embeddings.db
  --watch                        # re-run on file changes (debounced, uses chokidar)
  -v / -vv / ... -vvvvv          # verbosity (stackable; 0 = errors only, 5 = full debug)
```

**Setup and validation:**
```
virage init                      # interactive config generator
virage validate                  # validate virage.config.json against JSON schema
```

**Diagnostics and observability:**
```
virage report [--dir <path>]     # show telemetry summary from .virage/telemetry.json
virage chunks report             # chunk cohesion quality metrics (reads from embeddings.db)
virage viz embeddings            # 2D UMAP/t-SNE visualization of embedding space
virage dashboard                 # local real-time monitoring dashboard
virage benchmark embedder        # benchmark HuggingFace model throughput
virage store stats               # vector index quality metrics
virage store perf                # query performance report (p50/p95/p99 latency)
```

**Evaluation and experiments:**
```
virage eval-generate             # generate eval dataset from embeddings.db chunks
virage experiment run --name X   # run experiment and persist results
virage experiment list           # list saved experiment runs
virage experiment compare --baseline X --candidate Y  # bootstrap significance test
```

**`virage init`** (`src/cli/init.ts`): Scans the working directory for known file types, presents a pre-checked confirmation prompt, generates chunkers using the strategy shorthand, and prompts for secrets to write to `.env`. After secrets, it detects the project's package manager and offers to auto-install required packages. Falls back to manual strategy selection if no known types are found. Known extension groups: `.md`/`.mdx` → `markdownHeadersStrategy`, `.ts`/`.tsx`/`.js`/`.jsx`/`.py`/`.go`/`.cs`/`.java` → `tokenStrategy`, `.yaml`/`.yml` → `wholeFileStrategy`, `.txt` → `semanticStrategy`. Embedder and store choices are driven by `loadRegistry()`, so external plugins appear automatically.

**Config file loading** (`src/config-loader.ts`): Only JSON configs are supported. `loadConfig()` reads and parses the JSON, validates against `schemas/virage.config.schema.json`, expands `${ENV_VAR}` placeholders, and dynamically imports each `embedder.package` / `vectorStore.package` calling its `createEmbedder()` / `createVectorStore()` factory. Passing a `.ts` path throws a `ConfigError` with a migration suggestion pointing to `virage init`.

**Plugin registry** (`src/plugin-registry.ts`): `BUILT_IN_PLUGINS` lists all known embedders and stores. `loadRegistry(projectRoot)` merges built-ins with external plugins discovered from `node_modules` packages that declare a `"rag-plugin"` field in their `package.json`. External plugins override built-ins with the same `type:key`. Third-party packages self-register by adding:
```jsonc
"rag-plugin": {
  "type": "vectorStore",  // or "embedder"
  "label": "MyStore (hosted)",
  "key": "mystore",
  "envVars": ["MY_API_KEY"],
  "defaultConfig": { "apiKey": "${MY_API_KEY}", "url": "https://mystore.example.com" }
}
```
The `package` field is auto-filled from the containing `package.json`'s `name`.

**GitTracker glob ignores**: `getAllTrackedFiles()` excludes `node_modules/`, `dist/`, `build/`, `out/`, `coverage/`, `.git/`, `.next/`, `.turbo/`, `.cache/` so broad patterns like `**/*.ts` only match source files.

### Logger

**`packages/virage-cli/src/logger/`** — `createLogger(verbosity: number): Logger` factory used by the CLI. `ConsolaLogger` wraps `consola` for terminal output.

**`packages/virage-core/src/logger/null-logger.ts`** — `NullLogger` no-op for tests and library use (no consola dep).

- `0` = quiet (errors only), `1–5` = progressively more debug output (`-v` … `-vvvvv`)
- `ConsolaLogger` wraps `consola`; `NullLogger` is a no-op for tests.
- All provider packages (embedders, stores) accept `setLogger(logger: Logger)` so log output propagates through the full pipeline.

### Evaluation and Experiments (`src/eval/`)

| File | Purpose |
|---|---|
| `generator.ts` | Build eval datasets from existing chunks |
| `runner.ts` | Execute evaluation with metric collection |
| `ragas.ts` | RAGAS LLM-as-judge integration (requires OpenAI embedder) |
| `metrics.ts` | Precision/recall/NDCG computation |
| `statistics.ts` | Bootstrap confidence intervals, significance tests |
| `adaptive-tuner.ts` | Grid-search over chunker parameters |
| `experiment-store.ts` | Persist/load experiment runs; ID format `<name>_<iso-timestamp>` |
| `dataset-io.ts` | Read/write eval datasets |

Results stored under `.rag-experiments/` (gitignored except `.keep`).

### Telemetry (`src/core/telemetry.ts`)

`TelemetryCollector` records per-stage metrics: git tracking, chunking, embedding latency, upload latency, rate-limit events. Auto-saved to `.virage/telemetry.json` after each pipeline run. `virage report` reads and displays this file.

### Intermediate artifacts

All generated by the pipeline and gitignored. Override the root directory via `VIRAGE_DIR` env var. Cached in CI via `actions/cache`.

| File | Format | Contents |
|---|---|---|
| `.virage/embeddings.db` | SQLite (STRICT) | Chunk metadata + embedding BLOBs (Float32 LE) + `uploaded` flag. Embeddings cleared after upload to save storage. |
| `.virage/telemetry.json` | JSON | Pipeline run performance metrics |

`virage.config.ci.json` at the repo root is the CI-specific config (FastEmbed embedder + Postgres vector store) used by `.github/workflows/virage-update.yaml` — a standalone workflow that triggers on master pushes and installs published packages from npmjs rather than building from source. The pipeline step runs `virage update --config virage.config.ci.json` (the subcommand is required; `--config` is not a root-level flag).

### Acceptance tests (`packages/virage-core/test/acceptance/`)

A separate vitest suite (`vitest.acceptance.config.ts`) that exercises full CLI commands end-to-end using `virage-store-test` (file-backed mock store). Run from `packages/virage-core/`:

```bash
npm run test:acceptance
```

Set `E2E_CLONE_DIR` to reuse an existing clone and skip the slow clone step during iteration. 6-minute timeout; each test file runs in a forked process.

### Module import style

All internal imports use `.js` extensions (NodeNext requirement), e.g. `from "./git-tracker.js"` even though files are `.ts`. Keep this convention when adding new imports.

## Pre-commit rule

**Always run the following sequence before `git commit`.** The project pre-commit hook (`PreToolUse` on `Bash(git commit*)`) does this automatically:

```bash
npm run fix             # ESLint auto-fix + Prettier across all packages
npm run lint            # fails if any errors survive auto-fix — resolve before committing
npm run type-check:ci   # TypeScript check on all packages with working type files
```

Never commit when `npm run lint` or `npm run type-check:ci` report errors.

`virage-embedder-openai` and `virage-embedder-transformers` are excluded from `type-check:ci` because their third-party type declaration files (`openai/index.d.mts`, `@huggingface/transformers/types/transformers.d.ts`) are empty in this environment — a corrupted npm install that predates this project. Run `npm ci` in those packages to restore them.

## Release process

Releases are automated via release-please (`.github/workflows/release.yaml`). Commit messages must follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.) — this drives version bumping and CHANGELOG generation. The `prepublishOnly` script runs `build && test` before any publish.

All published packages are managed by release-please: `virage-core`, `virage-cli`, `virage-dashboard`, `virage-strategies`, `virage-embedder-{openai,transformers,fastembed}`, `virage-store-{postgres,qdrant,lancedb,chromadb}`. `virage-store-test` is private and excluded entirely. The dashboard publishes only its `dist/` folder (the Vite build output) to npm; it is also embedded into the CLI build via a file-copy.

Config: `.github/config/release-please.json`. Manifest (current versions): `.release-please-manifest.json`.

## Planning rules

Do not parallelize planning steps. Execute each step in order of appearance, or — when steps have explicit dependencies — in dependency order (fewest dependencies first). Wait for each step to complete before starting the next.
