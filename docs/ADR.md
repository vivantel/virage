# Architecture Decision Records

This document captures the key architectural decisions made in the `@vivantel/virage-core` project. Each entry follows the standard ADR format: Status, Context, Decision, and Consequences.

---

## ADR-001: ESM-first TypeScript with NodeNext module resolution

**Date:** 2026-05-31  
**Status:** Accepted

### Context

The library targets Node.js ≥ 18, which ships native ESM support. Consumers of RAG tooling are increasingly ESM-first themselves. CJS dual-publishing adds build complexity and frequently causes subtle interop bugs with dynamic `import()`.

### Decision

Ship as a pure ESM package (`"type": "module"` in `package.json`, `"module": "NodeNext"` in `tsconfig.json`). All internal imports use explicit `.js` extensions as required by NodeNext resolution (e.g. `from "./git-tracker.js"` even though source files are `.ts`).

### Consequences

- **+** Native ESM consumers get zero-friction integration.
- **+** No dual-build tooling to maintain.
- **−** CJS consumers (`require()`) cannot use the package without a wrapper.
- **−** All contributors must remember the `.js` extension convention on new imports.

---

## ADR-002: Four-stage linear pipeline architecture

**Date:** 2026-05-31  
**Status:** Accepted

### Context

A RAG indexing pipeline has four natural concerns: discovering which files changed, splitting files into chunks, embedding those chunks, and syncing embeddings to a vector store. Conflating these makes each stage harder to test, profile, and skip independently.

### Decision

Implement four discrete processor classes — `GitTracker`, `ChunkProcessor`, `EmbedderProcessor`, `Uploader` — wired together by `Orchestrator`. Each stage reads/writes intermediate JSON files (`chunks.json`, `embeddings.json`) so any stage can be re-run in isolation.

### Consequences

- **+** Each stage is independently testable and replaceable.
- **+** `--no-upload` and resume capabilities are natural fall-outs of the staged design.
- **+** Per-stage telemetry is straightforward to add (see ADR-010).
- **−** Two intermediate files on disk add I/O and must be managed/cached in CI.
- **−** Orchestrator must coordinate file paths across stages; currently defaults live in `Orchestrator` constructor (`./docs/rag/chunks.json`, `./docs/rag/embeddings.json`).

---

## ADR-003: Consumer-implemented provider interfaces

**Date:** 2026-05-31  
**Status:** Accepted

### Context

Different projects use different embedding providers (OpenAI, local models, GitHub Models) and different vector stores (Postgres, Pinecone, Supabase). Shipping one concrete implementation inside the core package would create tight coupling and a dependency explosion.

### Decision

Define three minimal TypeScript interfaces — `FileChunker`, `EmbeddingProvider`, `VectorStore` — that consumers implement. The core package ships no concrete implementations; it only ships the interfaces and the pipeline engine.

### Consequences

- **+** Core has zero provider-specific dependencies.
- **+** Any provider can be swapped at config time without touching the pipeline.
- **−** Getting started requires either writing an implementation or installing a companion package.
- This drove the companion package ecosystem (ADR-008).

---

## ADR-004: Git commit hash as the unit of change detection

**Date:** 2026-05-31  
**Status:** Accepted

### Context

Re-embedding all files on every pipeline run is prohibitively expensive (API cost and latency). We need a cheap, reliable signal for "this file changed since last run."

### Decision

`GitTracker` reads the HEAD commit hash for each tracked file via `simple-git`. This hash is stored in `chunks.json` alongside the chunks it produced. On the next run, the tracker compares stored hashes against current ones — only files with a changed hash are re-processed. When there are uncommitted changes, `-dirty` is appended to the hash to force re-processing of the working-copy state.

### Consequences

- **+** Incremental runs are cheap; only genuinely changed files flow through the pipeline.
- **+** The `-dirty` suffix gives correct behavior for local development.
- **−** Requires a git repository; non-git projects cannot use this mechanism.
- **−** Renamed files appear as delete + add, not as a move, so they are fully re-embedded.

---

## ADR-005: Content hash for embedding-layer incremental skip

**Date:** 2026-05-31  
**Status:** Accepted

### Context

File-level commit hashes (ADR-004) detect file changes, but a single file produces multiple chunks. If a file changes but only some chunks are modified, we would still re-embed all chunks from that file.

### Decision

`ChunkProcessor` computes a `contentHash` (SHA-256, first 16 hex chars) for each chunk's text. `EmbedderProcessor` skips any chunk whose `contentHash` already exists in `embeddings.json`, regardless of the file-level commit hash.

### Consequences

- **+** Embedding is idempotent: re-running on an unchanged chunk is a no-op.
- **+** Cheap insurance against partial failures — a crashed run resumes from the last checkpoint.
- **−** Content-hash comparisons happen in-memory against the full `embeddings.json`; very large embedding files could add startup latency.

---

## ADR-006: Strategy pattern for chunking, with `createChunker` composition helper

**Date:** 2026-05-31 (strategy pattern); 2026-05-31 (createChunker shorthand)  
**Status:** Accepted

### Context

Chunking logic varies by file type. Markdown files benefit from header-based splitting; code files benefit from token-window splitting; YAML configs are best kept whole. We need composability without requiring every consumer to write a full `FileChunker` class.

### Decision

Split chunking into two layers:

1. **`ChunkStrategy`** — lower-level, operates on raw text (`chunk(text, filePath)`). Four built-ins: `tokenStrategy`, `markdownHeadersStrategy`, `semanticStrategy`, `wholeFileStrategy`.
2. **`FileChunker`** — higher-level, reads files from disk (`chunk(filePath, commitHash)`). Consumers typically don't implement this directly.

The `createChunker` helper bridges the two via a TypeScript discriminated union:

- **Strategy shorthand**: `createChunker({ patterns, strategy })` — wraps any `ChunkStrategy` into a `FileChunker`, auto-derives a name.
- **Custom process**: `createChunker({ name, patterns, process })` — full control, name required.

### Consequences

- **+** Most configs need only one line per file type.
- **+** Strategies are independently testable without the file-system layer.
- **+** Custom chunkers remain a first-class option without API friction.
- **−** Two-layer abstraction is a mental model cost for new contributors.
- Strategies were later extracted to `@vivantel/virage-strategies` (ADR-008).

---

## ADR-007: `tsx` for zero-build TypeScript config loading

**Date:** 2026-05-31  
**Status:** Superseded by ADR-013

### Context

Consumer config files (`rag.config.ts`) are TypeScript. If consumers had to compile their config to JS before running the CLI, the DX would be painful. We need to load `.ts` files at runtime without requiring consumers to configure `ts-node` or Node's `--experimental-transform-types` flag.

### Decision

`loadConfig()` detects `.ts` extensions and loads them via `tsImport()` from `tsx/esm/api` (a runtime dependency). Plain `.js` configs use native `import()`. Consumers write TypeScript configs; no build step required.

### Consequences

- **+** `rag.config.ts` is ergonomic and type-safe for consumers.
- **+** Consumers get editor autocompletion on the config type.
- **−** `tsx` is a runtime dependency (not devDependency), increasing the installed footprint.
- **−** `tsx` transformation is a silent step; debugging config syntax errors can be confusing.
- **Superseded:** JSON-only config was adopted in ADR-013. `tsx` removed from runtime dependencies.

---

## ADR-008: Monorepo with per-package CI and independent versioning

**Date:** 2026-06-01  
**Status:** Accepted

### Context

Provider implementations (embedders, vector stores) have incompatible peer dependencies (e.g. `fastembed` vs `openai` vs `@xenova/transformers`). Shipping all of them inside `rag-core` would force consumers to install every provider's dependency tree regardless of which they use.

### Decision

Convert the repository to an npm workspaces monorepo (`packages/*`). Each provider is a separate package with its own `package.json`, CI workflow, CHANGELOG, and semver version:

| Package                                  | Role                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `@vivantel/virage-core`                  | Pipeline engine + interfaces + CLI                                   |
| `@vivantel/virage-strategies`            | Built-in chunk strategies (re-export, strategies deprecated in core) |
| `@vivantel/virage-embedder-openai`       | OpenAI embedding provider                                            |
| `@vivantel/virage-embedder-fastembed`    | FastEmbed (local) provider                                           |
| `@vivantel/virage-embedder-transformers` | Hugging Face Transformers provider                                   |
| `@vivantel/virage-store-postgres`        | PostgreSQL + pgvector store                                          |
| `@vivantel/virage-store-qdrant`          | Qdrant vector store (local and cloud)                                |

`release-please` is configured in manifest mode to publish each package independently.

### Consequences

- **+** Consumers install only the providers they use.
- **+** Provider packages can ship breaking changes without bumping `rag-core`.
- **+** Per-package CI catches regressions in isolation.
- **−** Contributors must understand npm workspaces and cross-package build order.
- **−** `rag-core` must be built before dependent packages can type-check.
- **−** Release-please configuration is non-trivial; manifest mode required several iteration fixes.

---

## ADR-009: `rag.config.ts` is gitignored; `virage.config.ci.json` is tracked

**Date:** 2026-06-01  
**Status:** Accepted

### Context

`rag.config.ts` contains provider credentials (API keys via environment references), path configurations, and project-specific chunker setups. Committing it risks leaking credentials and creates merge conflicts across forks.

### Decision

Add `rag.config.ts` to `.gitignore`, treating it like `.env`. The CI-specific config (`virage.config.ci.json`) is tracked because it is infrastructure-as-code — it references published package names and no secrets directly (credentials come from GitHub Actions secrets via `${VAR}` expansion at runtime).

### Consequences

- **+** No accidental credential commits.
- **+** Each consumer's config is tailored to their project without merge friction.
- **−** New contributors must run `virage init` or manually create the config — not apparent from a `git clone`.
- Documentation in README and `virage init` mitigates this.

---

## ADR-010: Telemetry as an opt-in pipeline concern

**Date:** 2026-05-31  
**Status:** Accepted

### Context

Understanding pipeline performance (per-stage duration, chunk counts, embedding latency) is useful for tuning but irrelevant to most runs. Baking telemetry into every stage would clutter the core logic.

### Decision

`TelemetryCollector` is instantiated only when `options.telemetry: true`. The `Orchestrator` holds a nullable reference (`telemetry?.recordX()`). On completion, telemetry prints a summary and saves to `telemetry.json` alongside `chunks.json`. Webhook notifications are a separate opt-in (`options.notifications.webhookUrl`).

### Consequences

- **+** Zero overhead when telemetry is off (the default).
- **+** Webhook notifications decouple alerting from the telemetry data model.
- **−** Telemetry data is local-file-only; no remote sink is built in.

---

## ADR-011: JSON config format with `${VAR}` environment variable expansion

**Date:** 2026-06-01  
**Status:** Accepted

### Context

TypeScript configs (`rag.config.ts`) require `tsx` at runtime and are developer-authored. For CI environments where the embedder and vector store are always the same published packages, a JSON config is simpler to generate, validate against a schema, and diff in PRs.

### Decision

`loadConfig()` dispatches on file extension: `.json` configs go through `loadJsonConfig()`, which:

1. Validates against a known schema (required fields, strategy names, package references).
2. Resolves `${ENV_VAR}` expressions recursively via `expandEnvVars()`.
3. Dynamically imports each provider package and calls `createEmbedder(config)` / `createVectorStore(config)`.
4. Maps strategy name strings (`"markdownHeaders"`, `"token"`, etc.) via `strategy-registry.ts`.

A JSON Schema is published at `schemas/virage.config.schema.json` for editor validation.

### Consequences

- **+** CI config is declarative, schema-validated, and credential-free.
- **+** Reduces friction for non-TypeScript environments.
- **−** JSON config cannot express custom chunker logic — only built-in strategies.
- JSON became the only supported format in ADR-013; the two-format surface area was eliminated.

---

## ADR-012: Model + dimensions mismatch triggers automatic full re-embed

**Date:** 2026-06-01  
**Status:** Accepted

### Context

If the embedding model changes between runs, all cached embeddings are invalid — vectors from different models are not comparable. Manual cache invalidation is error-prone.

### Decision

`embeddings.json` stores a `_meta` header (`EmbeddingsMeta`) with `model`, `providerDimensions`, `providerName`, `vectorStoreName`, `createdAt`, and `updatedAt`. On startup, `EmbedderProcessor` compares the current provider's model and dimensions against `_meta`:

- **Model or dimensions changed** → clear all embeddings, force full re-embed (loud warning to stdout).
- **Provider name changed but model/dimensions unchanged** → no invalidation (same model via OpenAI vs Azure vs GitHub Models produces identical vectors).
- **Vector store name changed** → `Uploader` forces a full re-upload on the next run.

Legacy `embeddings.json` files (bare arrays, no `_meta`) are read transparently via `embeddings-io.ts`.

### Consequences

- **+** Prevents silent vector corruption when switching models.
- **+** Provider name changes (e.g. OpenAI → Azure OpenAI, same model) do not wastefully re-embed.
- **+** Backwards compatible with existing `embeddings.json` files.
- **−** Adds a startup read of `embeddings.json` to compare metadata before processing begins.

---

## ADR-013: Plugin discovery via convention-based npm package exports

**Date:** 2026-05-31  
**Status:** Accepted

### Context

As the provider ecosystem grows, consumers should be able to reference providers by package name in their config rather than hand-writing import wiring. A lightweight discovery contract avoids a central registry.

### Decision

`discoverPlugins(packageNames)` dynamically imports each listed package and looks for `ragPlugin: RagPlugin` (single) or `ragPlugins: RagPlugin[]` (multiple) named exports. Each `RagPlugin` carries a `type` (`"embedder" | "store" | "chunker"`) and a `factory` function. Packages not following the convention emit a warning and are skipped.

### Consequences

- **+** Any npm package can become a RAG plugin with a trivial two-field export.
- **+** No central registry or peer-dependency declaration needed.
- **−** Discovery is eager (all listed packages are imported at startup).
- **−** No type-checking of plugin output; mismatched interfaces fail at runtime.
- The JSON config loader (ADR-011) uses a more explicit `createEmbedder`/`createVectorStore` contract, which is preferred for typed environments.

---

## ADR-014: Standalone CI workflow consuming published npm packages

**Date:** 2026-06-01  
**Status:** Accepted

### Context

Running the RAG update pipeline in CI used to build `rag-core` from source as part of the same job. After the monorepo restructure, the source layout changed and build ordering became fragile. Additionally, "run the RAG pipeline on docs" is a content-update concern, not a library-build concern.

### Decision

Extract the RAG pipeline into a dedicated workflow (`.github/workflows/virage.yaml`) that:

1. Installs `@vivantel/virage-core` and companion packages from the published npm registry (not from source).
2. Uses `virage.config.ci.json` (tracked, schema-validated).
3. Caches `docs/rag/chunks.json` and `docs/rag/embeddings.json` via `actions/cache` to make incremental runs fast.
4. Triggers only on pushes to `master`.

### Consequences

- **+** Decouples RAG pipeline health from library CI; each can fail independently.
- **+** CI config is pinned to released versions, not to whatever is on `master`.
- **+** Contributors don't need to build the library to run the pipeline locally.
- **−** A library change doesn't take effect in the RAG workflow until it's released and the workflow's dependency is updated.

---

## ADR-015: Postgres/pgvector as the canonical vector store; Supabase dropped

**Date:** 2026-06-01  
**Status:** Accepted

### Context

The initial vector store implementation targeted Supabase (`rag-store-supabase`). Supabase is PostgreSQL under the hood and exposes pgvector. Managing the Supabase client SDK (auth, realtime, storage bundled) was unnecessary overhead for a backend-only vector store use case.

### Decision

Replace `@vivantel/virage-store-supabase` with `@vivantel/virage-store-postgres`, which connects directly to PostgreSQL via `pg` + `pgvector`. The new package exposes `createVectorStore(config)` compatible with the JSON config format (ADR-011). Connection details are passed via environment variables expanded at load time.

### Consequences

- **+** Direct Postgres connection is simpler, lighter, and works with any Postgres host (self-hosted, RDS, Supabase, Neon, etc.).
- **+** Removes the Supabase SDK from the dependency tree.
- **−** Supabase-specific features (Row Level Security policies, realtime subscriptions) are no longer available.
- **−** Existing deployments using `rag-store-supabase` must migrate.

---

## ADR-016: Automated releases via release-please + Conventional Commits + npm provenance

**Date:** 2026-05-31  
**Status:** Accepted

### Context

Manual version bumps and CHANGELOG maintenance are error-prone. npm provenance (linking a published package to its source commit) is a supply-chain security best practice.

### Decision

- All commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, `feat!:` etc.).
- `release-please` runs in GitHub Actions manifest mode, generating version-bump PRs per package based on commit types.
- Publish uses GitHub Actions OIDC (`id-token: write`) for npm's trusted publisher mechanism, attaching a verifiable provenance attestation to every published tarball.
- `prepublishOnly` runs `build && test` as a final gate.

### Consequences

- **+** CHANGELOG and version bumps are automatic and consistent.
- **+** Each package versions independently (monorepo-safe).
- **+** npm provenance protects consumers from tampered packages.
- **−** Contributors must follow Conventional Commits; squash-merging with the wrong prefix silently delays a release.
- **−** release-please manifest mode configuration is non-trivial; it required several fixup commits to stabilize.

---

## ADR-013: JSON-only config; remove TypeScript config loading

**Date:** 2026-06-02  
**Status:** Accepted  
**Supersedes:** ADR-007

### Context

Two config formats (`virage.config.json` and `rag.config.ts`) were supported. The JSON format handles all practical use cases via `${ENV_VAR}` expansion and named built-in strategies. The TypeScript format required `tsx` as a runtime dependency, added complexity to `loadConfig()`, and was never the recommended path for CI (which always used JSON). Maintaining both added surface area without a proportional benefit.

### Decision

Remove TypeScript config loading entirely. `loadConfig()` now only handles JSON. Passing a `.ts` path raises a `ConfigError` with a migration suggestion. `tsx` is moved from `dependencies` to `devDependencies` (kept only for the `dev` watch script). The `init` command no longer offers a "TypeScript format" option.

### Consequences

- **+** Simpler `loadConfig()` — one code path, one format.
- **+** `tsx` removed from the published package's runtime dependency tree.
- **+** `init` wizard is simpler and always produces a working JSON config.
- **−** Breaking change for consumers using `rag.config.ts`. Migration: run `virage init` or rename to `.json` and convert manually.

---

## ADR-017: Logger abstraction with consola and stackable `-v` verbosity

**Date:** 2026-06-02  
**Status:** Accepted

### Context

Raw `console.*` calls were scattered across the pipeline and all plugin packages. There was no way to silence output in tests or increase verbosity in debugging sessions without editing source code.

### Decision

Introduce a `Logger` interface with two implementations: `ConsolaLogger` (wraps `consola`, default) and `NullLogger` (silences all output). The CLI exposes a stackable `-v` flag (0–5 levels); the resolved log level is passed to `createLogger(verbosity)` and threaded through `Orchestrator` and all pipeline stages. All plugin packages add a `setLogger(logger: Logger)` method so the orchestrator can propagate the logger without coupling plugins to a specific logging library.

### Consequences

- **+** Tests can use `NullLogger` to silence pipeline output without I/O redirection.
- **+** `-vvv` gives progressively more detailed output without code changes.
- **+** Plugins remain decoupled from any specific logging library.
- **−** All plugin packages needed updating to accept `setLogger()`.

---

## ADR-018: Vitest acceptance test suite in `test/acceptance/`

**Date:** 2026-06-03  
**Status:** Accepted

### Context

The prior shell-script e2e test was not integrated with CI, produced no structured output, had no per-test isolation, and required manual inspection to determine pass/fail.

### Decision

Replace the shell script with a Vitest-based acceptance suite under `packages/rag-core/test/acceptance/`. Separate `vitest.acceptance.config.ts` sets a 6-minute test timeout, `forks` pool (for subprocess isolation), and verbose reporter. Fixture helpers (`writeChunks`, `writeEmbeddings`, `writeTelemetry`, `writeExperimentRun`) allow most tests to skip the full pipeline. `E2E_CLONE_DIR` environment variable bypasses the slow `git clone` step so developers can iterate quickly. One test per CLI command.

### Consequences

- **+** Per-test failure isolation; JUnit-compatible output for CI.
- **+** Typed JSON assertions instead of stdout grep.
- **+** Fixture-based tests run in seconds; only `update` and `store` require the full pipeline.
- **−** First run takes ~10 minutes (clone + embed); `E2E_CLONE_DIR` required for fast iteration.

---

## ADR-019: `@vivantel/virage-store-test` private workspace package

**Date:** 2026-06-03  
**Status:** Accepted

### Context

The acceptance tests needed a `VectorStore` implementation that persists state to a local JSON file so the full pipeline can run without a real database. The implementation lived in `scripts/test-store.mjs` and was referenced by an absolute file path in `vectorStore.package` — fragile and not resolvable by the standard `import()` mechanism used by `loadConfig()`.

### Decision

Promote the implementation to a private TypeScript workspace package `@vivantel/virage-store-test`. The config references it as `"package": "@vivantel/virage-store-test"` and the npm workspace symlink resolves it correctly. The package deliberately has no `rag-plugin` field so it is not auto-discovered by `loadRegistry()`. It fully implements `VectorStore` including `getIndexStats()` and `getQueryPerfReport()` (returning stub zeroes).

### Consequences

- **+** Config uses a clean package name rather than a fragile absolute path.
- **+** Type-safe TypeScript implementation; peer-depends on `@vivantel/virage-core` for the interface types.
- **+** No risk of accidental production use (no `rag-plugin` field, `private: true`).
- **−** One additional package to build before running acceptance tests.

---

## ADR-020: `virage index` subcommand; `help` as default action

**Date:** 2026-06-03  
**Status:** Accepted (renamed `update` → `index` 2026-06-05)

### Context

Running bare `virage` executed the full pipeline silently — a poor experience for first-time users and dangerous in scripts that accidentally call the wrong binary. Other popular CLIs (git, npm, cargo) show help when called without a subcommand.

### Decision

Move the pipeline execution logic from the root program action into an explicit `index` subcommand (originally `update`, renamed for clarity). The root program's `.action()` now calls `program.outputHelp()`. All existing flags (`--force`, `--no-upload`, `--dry-run`, `--embeddings-out`, `--watch`) are unchanged, just moved under `index`. The stackable `-v` flag remains on the root program and is inherited by `index` via `program.opts()`.

### Consequences

- **+** Running `virage` with no arguments prints help — discoverable and safe.
- **+** All subcommands now follow the same `virage <command>` pattern.
- **−** Breaking change: scripts calling `virage update` must be updated to `virage index`.

---

## ADR-021: SQLite as intermediate embeddings storage, replacing monolithic JSON

**Date:** 2026-06-03  
**Status:** Accepted  
**Supersedes:** parts of ADR-002 (intermediate file format) and ADR-005 (content-hash skip mechanism)

### Context

`embeddings.json` was a monolithic file that was fully read and rewritten on every save. This created three problems:

1. **Re-embed bug on partial runs**: the file tracked only final embeddings, with no distinction between "embedded but not yet uploaded" and "embedded and uploaded". When a run embedded some chunks and uploaded them, then was interrupted before finishing, the next run couldn't tell which chunks were already in the vector store and would re-embed them from scratch.
2. **Full read-merge-write on every batch save**: even a small incremental batch triggered a full JSON parse, in-memory merge, and full-file serialise/write cycle — O(n) in total embedding count, every time.
3. **No streaming ingestion**: there was no way to upload a batch to the vector store while later batches were still being embedded.

### Decision

Replace `embeddings.json` with an SQLite database (`embeddings.db`, derived by substituting the extension). The `EmbeddingsDb` class wraps `better-sqlite3` (synchronous API) and owns the full storage contract:

- Each row tracks `content_hash`, source/commit/content/metadata/embedding fields, and an `uploaded INTEGER` flag (`0` = pending, `1` = uploaded to vector store).
- `EmbeddingsMeta` is stored in a separate `meta` table as a single JSON value.
- On first construction, if the database is empty and a sibling `.json` file exists, `EmbeddingsDb` auto-migrates the JSON, marking migrated rows as `uploaded = 1` (they were already synced), then renames the JSON to `.json.migrated`.

The `Orchestrator` derives the db path from `embeddingsFile` (`foo/embeddings.json` → `foo/embeddings.db`), constructs one `EmbeddingsDb` instance, and passes it to both `EmbedderProcessor` and `Uploader`. The db is closed in a `finally` block at the end of `run()`.

### Consequences

- **+** Re-embed bug fixed: `getChunksToEmbed` reads `db.getAll()` (pending + uploaded) for skip detection, so already-uploaded chunks are never re-embedded after a partial run.
- **+** Saves are atomic row inserts via a SQLite transaction; no read-merge-write cycle.
- **+** `uploaded` flag enables `getPending()`, `markUploaded()`, and `uploadPending()` — the building blocks for intermediate batch ingestion (ADR-022).
- **+** WAL journal mode allows concurrent reads during writes.
- **−** `better-sqlite3` is a native module (compiled via node-gyp). It must be rebuilt when switching Node.js ABI versions; pre-built binaries are downloaded by `prebuild-install` on supported platforms.
- **−** The intermediate artifact is now a binary `.db` file rather than a human-readable `.json`. Inspecting it requires a SQLite tool.
- **−** Migration from JSON is one-way; once the `.json` is renamed to `.json.migrated`, only SQLite is used. Rolling back to an older version of the pipeline that reads JSON requires manual renaming.

---

## ADR-022: Mid-run partial uploads via `onIntermediateBatch` callback

**Date:** 2026-06-03  
**Status:** Accepted

### Context

Before this change, the upload stage ran only after all embeddings were complete. For large corpora, this meant the vector store was empty until the very end of the run, and a failure during upload (after a long embedding stage) would require re-uploading everything. The SQLite `uploaded` flag (ADR-021) made it possible to upload a batch mid-run and record exactly which chunks had been delivered.

### Decision

`EmbedderProcessor.run()` accepts an optional `onIntermediateBatch?: () => Promise<void>` callback and a `minIngestionBatchSize` constructor option (default `Infinity` — disabled). After each timed save, if `db.pendingCount() >= minIngestionBatchSize`, the callback is invoked. The orchestrator wires this to:

```typescript
async () => {
  await uploader.uploadPending(db);
};
```

`uploadPending(db)` uploads only pending rows (no delta check against the vector store, no delete phase) and calls `db.markUploaded(contentHashes)` after each batch.

`minIngestionBatchSize` is exposed as a first-class option in `RAGPipelineConfig.options` and in the JSON config schema.

### Consequences

- **+** The vector store is populated incrementally — useful for long embedding runs and for monitoring progress in real time.
- **+** A failure late in the run only requires re-uploading the remaining pending chunk, not re-uploading everything.
- **+** Configurable threshold means the feature is off by default and can be tuned per corpus size.
- **−** `uploadPending` skips the delta check, so intermediate uploads are always upserts with no corresponding delete. Files being re-indexed from a changed commit will have their old chunks in the store until the final `sync()` delete sweep runs at the end of the pipeline.
- **−** If `skipUpload` is set, the intermediate callback is suppressed entirely; the threshold has no effect.

---

## ADR-023: Fail-fast on fatal vector store errors; skip retries

**Date:** 2026-06-03  
**Status:** Accepted

### Context

The retry loop in `Uploader` treated all errors as transient. Schema mismatches (e.g. the LanceDB "Schema Error: Provided schema does not match existing table schema") and authentication failures are deterministic — they will not succeed on any subsequent attempt. Retrying them wastes time and obscures the real error.

### Decision

Introduce `isFatalVectorStoreError(err: unknown): boolean` in `uploader.ts`:

```typescript
const msg = String(err instanceof Error ? err.message : err).toLowerCase();
return /schema error|schema mismatch|unauthorized|authentication failed/.test(
  msg,
);
```

All `withRetry` calls in `Uploader` (both `sync()` and `uploadPending()`) now pass `isRetryable: (err) => !isFatalVectorStoreError(err)`. A fatal error causes `withRetry` to rethrow immediately, skipping all remaining retry attempts.

The LanceDB "Schema Error" root cause was also fixed independently: `LanceDBVectorStore.initialize()` now uses an explicit open-or-create pattern (`tableNames()` → `openTable` or `createEmptyTable`) instead of `createEmptyTable(..., { existOk: true })`, which was triggering Arrow schema validation on every second run. The fail-fast rule ensures that any remaining schema mismatches from other stores produce an immediate, clear error rather than a delayed one after max retries.

### Consequences

- **+** Schema and auth errors surface immediately with the full error message, rather than failing after the retry budget is exhausted.
- **+** Removes spurious wait time (retry back-off intervals) for unrecoverable failures.
- **+** LanceDB specifically no longer throws on the second run; the fail-fast path is a safety net for the general case.
- **−** Error classification is regex-based on message strings. Provider-specific error messages that don't match the pattern will still be retried unnecessarily; the pattern may need expanding as new store implementations are added.

---

## ADR-024: Split `virage-core` into library (`virage-core`) + CLI (`virage-cli`) + dashboard (`virage-dashboard`)

**Status:** Accepted

### Context

`@vivantel/virage-core` bundled pure business logic (orchestrator, chunkers, embedders, eval framework, SQLite storage) together with CLI-only code (commander, cli-progress, @inquirer/prompts, consola, dotenv, all command handlers). Library consumers were forced to install all CLI dependencies even when using virage-core programmatically. The embedded HTML template in `cli/dashboard.ts` also limited UI complexity.

### Decision

1. **`@vivantel/virage-core`** remains the library package (same npm name, no breaking rename). CLI deps (`commander`, `cli-progress`, `@inquirer/prompts`, `consola`, `dotenv`) removed. The `bin` field removed.

2. **`@vivantel/virage-cli`** is a new published package providing the `virage` binary. It depends on `@vivantel/virage-core` and holds all CLI command handlers, logger implementations, and the progress bar wrapper.

3. **`@vivantel/virage-dashboard`** is a new private React + Vite web app served by `virage dashboard`. The HTTP API (three JSON endpoints) is in `virage-cli`; the React app is built separately and embedded.

4. **Orchestrator progress reporting** changed from internal `createProgressBar` calls to optional `onChunkProgress`, `onEmbedProgress`, `onUploadProgress` callbacks in `RAGPipelineConfig.options`. The CLI layer creates bars and passes them; library consumers ignore them.

5. **`IGNORED_DIRS`** moved from `cli/file-detect.ts` to `core/virage-defaults.ts` so `GitTracker` (business logic) can import it without a circular dep.

### Consequences

- **+** Library consumers can install `@vivantel/virage-core` with ~5 fewer transitive deps.
- **+** React dashboard can be developed independently and has proper component structure.
- **+** Orchestrator is now testable without any CLI dep mocking.
- **−** Users who install `@vivantel/virage-core` for the `virage` binary must now also install `@vivantel/virage-cli`. Documentation update required.
- **−** Build order must ensure virage-core is built before virage-cli (npm workspaces handles this via the declared dependency).

---

## ADR-025: Universal agent hook base package (`virage-agent-core`)

**Date:** 2026-06-11  
**Status:** Accepted

### Context

`virage-agent-claude` was a standalone package with no shared contract for agent hook configuration. Adding support for additional coding agents (GitHub Copilot, OpenAI Codex, Google Antigravity) would require duplicating type definitions and boilerplate in each package, with no guarantee of consistency.

The YAML-based Universal Agent Hook Event Model defines 33 normalized event names and vendor-specific mappings for all 4 supported agents. This schema needed a canonical TypeScript representation.

The `virage-cli` init wizard Step 2 hardcoded `{ name: "Claude", value: "claude" }`, preventing dynamic discovery of newly installed agent plugins.

### Decision

1. **`@vivantel/virage-agent-core`** — new shared package with:
   - `NormalizedEventName` union type (33 events)
   - `VendorConfig` interface and four constants (`CLAUDE_VENDOR_CONFIG`, `COPILOT_VENDOR_CONFIG`, `CODEX_VENDOR_CONFIG`, `ANTIGRAVITY_VENDOR_CONFIG`) encoding the full event→vendor name mapping
   - `BaseAgentPlugin` abstract class with `supportsEvent()`, `getVendorEventName()`, `getPrimaryEventName()`, and abstract `configure()` method
   - Common I/O types: `AgentHookInput`, `AgentHookOutput`, `PreToolUseInput/Output`, `AgentStopInput/Output`, etc.

2. **All four agent packages extend `BaseAgentPlugin`**: `virage-agent-claude` (refactored to 0.2.0), plus three new packages `virage-agent-copilot`, `virage-agent-codex`, `virage-agent-antigravity`. Each implements `configure(targetDir)` to write vendor-specific hook config files by translating `virage-skills/agent-config/hooks.json`.

3. **virage-cli init wizard** Step 2 calls `discoverAgentPlugins()` before the loop and builds choices dynamically from installed plugins, falling back to a hardcoded Claude Code entry if none are found. The agent filter was updated to match on `p.name` (exact) instead of `p.label.toLowerCase().includes(a)` (substring).

### Consequences

- **+** New agent vendors can be added as separate npm packages without touching `virage-cli`.
- **+** Consistent TypeScript types across all agent integrations.
- **+** Init wizard automatically shows newly installed agent plugins.
- **−** `virage-agent-claude` version bumped to 0.2.0; existing users must update.
- **−** `virage-agent-core` is a new required peer for all agent packages.

---

## ADR-026: Static-file copier model for agent plugins

**Date:** 2026-06-12  
**Status:** Accepted

### Context

After ADR-025 introduced `BaseAgentPlugin`, each vendor plugin (`claude`, `copilot`, `codex`, `antigravity`) still contained imperative `configure()` logic to: (1) read the normalized `hooks.json` from `@vivantel/virage-skills`, (2) translate it to vendor-specific format, and (3) write/merge the result into vendor config files. The translation logic was duplicated across `config.ts` files in each plugin package.

Additionally, the `/plan` slash command was absent from all agent integrations. There was no standard way to add vendor-specific command files without extending the translation pipeline further.

### Decision

1. **Plugins ship static `plugin-config/` directories.** Each vendor plugin package contains a `plugin-config/` folder with pre-authored, vendor-native config files (hook configs, command files, etc.). These are maintained manually in sync with `virage-skills/agent-config/hooks.json` — no runtime translation.

2. **`BaseAgentPlugin.configure()` is now concrete.** It resolves the plugin package root via `createRequire(import.meta.url).resolve(vendorConfig.packageName + '/package.json')`, then recursively copies `plugin-config/` to `targetDir/vendorConfig.projectConfigDir`. Files are only written when content changes (content-equality check before overwrite), so `hooksWritten` is `false` on idempotent re-runs.

3. **`VendorConfig` gains three fields:** `packageName` (npm package name, used to resolve plugin root), `pluginConfigDir` (subdir within the package, always `"plugin-config"`), and `projectConfigDir` (project-relative write target, e.g. `".claude"`, `".github/copilot"`, `".codex"`, `".antigravity"`).

4. **`/plan` slash command.** Claude plugin ships `plugin-config/commands/plan.md` → written to `.claude/commands/plan.md`, creating a `/plan` slash command in Claude Code. Copilot ships `plugin-config/instructions/virage-plan.md` → `.github/copilot/instructions/virage-plan.md`. Both reference `.agents/skills/virage/planner/SKILL.md`.

5. **Claude plugin retains one override.** `ClaudeAgentPlugin.configure()` calls `super.configure()` (for the static file copy) then calls `mergeMcpServer()`, which registers the MCP server via `claude mcp add virage --scope project -- npx -y @vivantel/virage-agent-claude@latest`. Falls back to direct `.mcp.json` editing when the `claude` CLI is unavailable. MCP registration is Claude-specific and cannot be expressed as a static file.

6. **`config.ts` translation files removed** from `virage-agent-copilot`, `virage-agent-codex`, and `virage-agent-antigravity`. Shared PM helpers extracted from `init.ts` into `virage-cli/src/cli/pkg-manager.ts`.

7. **`virage update` command added.** Discovers `@vivantel/*` and `rag-plugin`/`virage-agent` packages from `package.json` and chunker packages from `virage.config.json` (e.g. `codeChunkAst` → `@vivantel/virage-code-chunk-chunker`), shows current vs. latest versions, and runs `pm install pkg@latest` for selected packages. Optionally re-runs agent plugin configuration and re-syncs skills.

### Consequences

- **+** Vendor plugins are thin: ~15 lines of TypeScript each for copilot/codex/antigravity, no imperative hook translation.
- **+** Static files are diff-friendly, auditable, and version-controlled alongside the plugin package.
- **+** `/plan` command available in Claude Code after `virage init`; Copilot retains `virage-plan` instruction.
- **+** `virage update` provides one-command ecosystem maintenance including chunker packages discovered from `virage.config.json`.
- **−** Static hook files must be manually updated when `virage-skills/agent-config/hooks.json` changes.
- **−** `VendorConfig` now embeds `packageName`, coupling the constant to the published package name; renaming a package requires updating the constant.

---

## ADR-027: `list_skills` response shape change — `string[]` → `SkillMeta[]`

**Date:** 2026-06-15
**Status:** Accepted

### Context

The `list_skills` MCP tool returned a bare `string[]` of skill names. To choose the right skill, Claude had to call `read_skill` for each candidate — an O(n) round-trip chain that consumed 1,000–2,000 tokens per skill loaded. With 12 skills registered, orienting to the right skill cost up to 24 redundant tool calls in the worst case.

Separately, the new `suggest_skill` tool (added in this release) needs `when_to_use` metadata to perform keyword-based skill routing without any tool round-trips. Without structured frontmatter in the response, `suggest_skill` would require its own separate metadata read pass.

### Decision

1. **Skill SKILL.md files gain four new YAML frontmatter fields:** `when_to_use` (string[]), `prerequisites` (string[]), `estimated_tokens` (number), and `output_format` (string). These are maintained as part of the skill authoring standard (see skill-guru skill).

2. **`list_skills` response changes from `string[]` to a structured object:**
   ```json
   {
     "schema_version": 2,
     "names": ["analyst", "architect", ...],
     "skills": [
       {
         "name": "planner",
         "description": "...",
         "when_to_use": ["Breaking down a complex request..."],
         "prerequisites": [],
         "estimated_tokens": 1932,
         "output_format": "Plan written to docs/internal/next_plan.md",
         "has_summary": true
       }
     ]
   }
   ```
   The `names` field preserves backward compatibility for any consumer that parsed the old `string[]` response. `schema_version: 2` allows future tooling to branch on format.

3. **`parseFrontmatter(content)` helper** extracts the new fields from SKILL.md using regex (no new runtime deps). Falls back to safe defaults if a field is absent.

4. **`list_skills` tool description** is updated to document the new response shape, so Claude knows to use `skills[i].when_to_use` for routing decisions.

### Consequences

- **+** Claude can make skip/load/summary decisions from a single `list_skills` call instead of N `read_skill` calls.
- **+** Enables the `suggest_skill` keyword-routing tool without additional I/O.
- **+** `estimated_tokens` gives Claude a cost signal before loading a skill.
- **−** Consumers that parsed the raw `string[]` return value must be updated to read `skills[]` or `names[]`.
- **−** Frontmatter maintenance burden: authors must keep `estimated_tokens` roughly accurate as skills grow.

---

## ADR-028: Branch-aware RAG via metadata tagging, per-file dirty detection, and search command

**Date:** 2026-06-15
**Status:** Accepted

### Context

The RAG pipeline stored all chunks in a single `.virage/virage.db` + vector store with no branch awareness. Switching branches could surface stale results from files that differed between branches. Additionally, the `GitTracker` used a global dirty flag — if any file in the working tree was uncommitted, every tracked file was appended `-dirty` and re-indexed on the next run, causing unnecessary re-embedding of files that were actually clean.

The existing `mcp__virage__search` reference in `plugin-config/commands/rag.md` pointed to an MCP tool that did not exist, making the `/rag` slash command non-functional.

Finally, after a `git pull` or branch checkout there was no mechanism to automatically bring the index up to date.

### Decision

1. **Single DB with branch metadata tagging (no per-branch DBs).** At `virage index` time, `GitTracker.getCurrentBranch()` detects the current branch (via `git rev-parse --abbrev-ref HEAD`). The orchestrator injects `{ branch: "<name>" }` into each chunk's `metadata` field before inserting into SQLite. At query time, an optional `filter: { branch }` narrows results via post-filter on the parsed `metadata_json`. Separate DBs per branch were rejected because they would require re-embedding all content for every branch, defeating the delta-indexing design.

2. **Per-file dirty detection.** `hasUncommittedChanges()` (global `boolean`) is replaced by `getDirtyFiles()` which calls `git.status()` once and returns a `Set<string>` of modified paths. Only files present in that set receive the `-dirty` commit-hash suffix; clean files on the same working tree continue to use their true commit hash. This eliminates the cascade where a single dirty file caused full re-indexing.

3. **`filter?: Record<string, unknown>` added to `SearchOptions`.** The LanceDB store fetches `topK × 4` results and applies the filter as an in-process metadata match (no schema migration required for existing indexes). The `collection` interface parameter was left as-is but is now semantically superseded by `filter.branch`.

4. **`virage query <text>` CLI command** (in `virage-cli`). Loads `virage.config.json`, embeds the query text, calls `vectorStore.search()`, and outputs human-readable or `--json` results. Accepts `--top-k` and `--branch` flags.

5. **`search` MCP tool** added to `virage-agent-claude`. Rather than loading the embedder and vector store directly in the MCP server process (which runs from npx cache and cannot resolve project-local plugin packages via ESM `import()`), the tool spawns `virage query --json` as a subprocess using the project-local `node_modules/.bin/virage` binary (falls back to PATH). This correctly inherits the project's Node.js module resolution context. The `/rag` slash command is now functional.

6. **`virage install-hooks` command** (in `virage-cli`). Writes idempotent `post-merge` and `post-checkout` shell scripts to `.git/hooks/`, each calling `npx virage index`. This ensures the index stays current after `git pull` and branch switches. `--uninstall` removes only the Virage-added content (identified by a marker comment), preserving any pre-existing hook logic.

7. **`/index` slash command** (`plugin-config/commands/index.md`). Added to the Claude Code agent plugin. Instructs Claude to run `virage index $ARGUMENTS` via the Bash tool, covering `--force`, `--dry-run`, `--no-upload`, and `--watch` use cases.

### Consequences

- **+** Branch-scoped search without re-embedding shared content; `virage query --branch feature-x` narrows results to that branch's indexed files.
- **+** Per-file dirty detection eliminates spurious full re-indexes from a single uncommitted file.
- **+** `/rag` command is now functional end-to-end.
- **+** `/index` command lets agents trigger indexing without leaving the chat interface.
- **+** `virage install-hooks` automates post-pull re-indexing with no manual setup.
- **−** Post-filter approach for `branch` means the effective result count may be < topK when many chunks lack the branch tag (e.g. indexes built before this change). Run `virage index --force` to re-tag all chunks.
- **−** `virage query` subprocess adds ~1–2 s cold-start latency to the first MCP search call (embedder initialization); subsequent calls within the same session pay similar startup cost since the subprocess is not persistent.
- **−** `virage install-hooks` installs to `.git/hooks/` which is not committed to the repo. Each contributor must run it manually.

---

## ADR-029: No switch to Claude Code native subagents for Virage skills

**Date:** 2026-06-15
**Status:** Accepted

### Context

Virage skills are delivered as static `.md` files (with YAML frontmatter) that are copied into vendor-specific config directories by `BaseAgentPlugin.configure()`. For Claude Code, skills are also discoverable via 6 MCP tools (`list_skills`, `read_skill`, `suggest_skill`, etc.). The question arose whether to replace or augment this model with Claude Code's native `Agent` tool (subagent dispatch) for deterministic skills like `code-guardian` or `qa`, to gain isolated context windows, parallel execution, and typed return values.

### Decision

**Do not switch to Claude Code native subagents.** Keep the static `.md` skill model for all four supported agents.

Reasons:

1. **Vendor parity (ADR-026).** Copilot, Codex, and Antigravity have no equivalent of Claude Code's `Agent` tool. Adding Claude-only subagent dispatch paths creates a permanently diverging codebase: three of four vendors would receive a degraded experience, and any skill that uses subagent dispatch becomes Claude Code-only.

2. **Human-in-loop continuity.** Skills like `planner` and `architect` require iterative back-and-forth with the user (plan approval, ADR review). Subagents start cold, return opaque results, and break the single-thread conversational flow that makes these skills effective.

3. **The MCP layer is the right abstraction boundary.** ADR-027's `suggest_skill` + `list_skills` already give single-round-trip routing. The `search` MCP tool (ADR-028) extends this with data retrieval. Adding a `run_skill` MCP tool that spawns a subagent internally would couple the MCP server to the Claude API, break vendor parity at the MCP level, and add billing complexity.

4. **Revisit condition.** If Copilot agent mode, Codex, or Antigravity gain a vendor-neutral subagent dispatch API at the same abstraction level, reassess. Until then, improve the existing model: richer skill frontmatter, better hook triggering, and more MCP data tools.

### Consequences

- **+** All four agent vendors continue to receive the same skill content.
- **+** No new dependencies on the Claude API within the Virage packages.
- **+** Skills remain auditable static files, not opaque agent invocations.
- **−** Deterministic skills (`code-guardian`, `qa`) execute inline in the parent session, adding their tool calls to the main context window rather than isolating them.
- **−** No parallel skill execution without vendor-specific workarounds.

---

## ADR-030: Semver ranges in peerDependencies for inter-package virage dependencies

**Date:** 2026-06-17  
**Status:** Accepted

### Context

Virage is a monorepo of 20+ packages that can be mixed and matched by consumers (e.g., using `virage-core` with a custom embedder, or `virage-store-lancedb` independently). Currently, published packages pin their inter-package dependencies to exact versions in `dependencies`, which means consumers cannot adopt a patched version of one package without upgrading the whole ecosystem.

Users also want to express "my project requires virage-core ≥ 0.2.28" rather than being forced to land on a single exact version. The current pinned-exact model prevents this.

### Decision

**Published packages that consume other virage packages** (embedders, stores, agents, strategies) should declare those virage packages as `peerDependencies` with a semver range, and keep an exact pinned version only in `devDependencies` (used for local monorepo builds and CI):

```jsonc
// e.g., in virage-embedder-openai/package.json
{
  "peerDependencies": {
    "@vivantel/virage-core": ">=0.2.28 <0.3.0"
  },
  "devDependencies": {
    "@vivantel/virage-core": "0.2.28"   // exact, for monorepo builds
  }
}
```

The range constraint `>=X.Y.Z <X.(Y+1).0` (minor-locked for pre-1.0 packages) signals: "any patch release in this minor series is compatible." Once the project reaches 1.0, switch to `^X.Y.Z` (compatible within the major).

**`virage-cli` is the exception** — it is a tool, not a consumed library. It keeps exact `dependencies` because it is always installed at a fixed version (globally or via npx) and does not participate in downstream resolution.

**Changesets vs Release Please:** Changesets are not adopted. Release Please already automates semver versioning via conventional commits and handles coordinated bumps across the monorepo via `.release-please-manifest.json`. Changesets would require every contributor to run an extra manual step with no net benefit given the existing automation.

**Implementation:** The peerDependency migration happens as part of a coordinated minor-version bump (separate PR) to avoid breaking consumers that rely on the current exact-dep resolution behavior.

### Consequences

- **+** Consumers can adopt a patched version of one virage package (e.g., a security fix in `virage-core`) without upgrading the full ecosystem.
- **+** `npm install` resolves the constraint declaratively; no runtime version-checking code needed.
- **+** Aligns with standard npm library conventions.
- **−** Minor coordination cost: peerDep ranges must be updated when a package introduces a breaking change.
- **−** `npm install` will warn about unmet peer dependencies if a consumer installs an incompatible version — this is intentional and informative.

---

## ADR-031: `chunking` config section with global exclude patterns

**Date:** 2026-06-20
**Status:** Accepted

### Context

The root-level `chunkers` array in `virage.config.json` had no mechanism for excluding files globally — every chunker had to embed exclusion logic into its own pattern list, leading to repetition. Common generated, minified, or dependency-managed files (lock files, `dist/`, `vendor/`, compiled artifacts) were indexed unnecessarily, wasting embedding calls and polluting search results.

A related issue: `CliGitSourceRepository` included changed and pending files regardless of whether the file was otherwise configured to be skipped by `GitTracker`.

### Decision

Introduce a `chunking` wrapper object in the config schema that groups:
- `chunkers` — the existing array of chunker definitions (now nested)
- `exclude` — a new optional `string[]` of glob patterns excluded from all chunkers globally

**Backward compatibility**: configs with `chunkers` at the root are promoted to `chunking.chunkers` at load time by `normalizeConfig()` — before JSON Schema validation runs — so no consumer migration is required.

**Default exclude patterns** (written by `virage init`, exported as `DEFAULT_EXCLUDE_PATTERNS` from `virage-core`):
- Node.js: `**/yarn.lock`, `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/.next/**`, `**/.turbo/**`
- .NET: `**/bin/**`, `**/obj/**`, `**/*.generated.cs`, `**/*.pb.cs`
- Java: `**/target/**`, `**/*.class`
- Go: `**/*.pb.go`
- C/C++: `**/CMakeFiles/**`, `**/cmake-build-*/**`, `**/*.o`, `**/*.a`
- Universal: `**/dist/**`, `**/out/**`, `**/vendor/**`, `**/*.min.js`, `**/*.min.css`, `**/*.lock`, `**/*.pb.ts`

**Filtering is applied at two layers**:
1. `GitTracker.getAllTrackedFiles()` merges `excludePatterns` into glob's `ignore` option for efficient directory pruning, then post-filters file-level patterns via `minimatch`.
2. `CliGitSourceRepository.getChangedFilesSince()` and `getPendingChanges()` filter results through `isExcluded()` so excluded files never enter the pipeline as pending changes either.

### Consequences

- **+** Single canonical exclude list applies to all chunkers; no per-chunker repetition.
- **+** `virage init` seeds sane defaults per ecosystem — new projects exclude common noise automatically.
- **+** Directory-level pruning in glob avoids descending into `vendor/` or `target/`, cutting scan time for large repos.
- **+** Full backward compatibility: old root-level `chunkers` configs load without changes.
- **−** `normalizeConfig()` must stay in sync if new top-level chunking config fields are added.
- **−** Schema keeps a deprecated optional `chunkers` at root (so the schema itself doesn't reject old configs before the runtime normalizer runs).

---

## ADR-032: Scanning and chunking performance + global model dir + GPU support

**Date:** 2026-06-20
**Status:** Accepted

### Context

Three independent performance and ergonomics problems were observed simultaneously:

1. **Scanning speed**: `getFileRevisions()` in `CliGitSourceRepository` was sequential. Dirty files were already hashed in parallel via `Promise.all`, but untracked files (not in HEAD tree and not in `git status`) each spawned a sequential `git hash-object` subprocess inside the main loop — O(N) subprocess forks, one at a time. On repos with many untracked files this limited scanning to 20–30 files/sec.

2. **Chunking throughput**: The `Orchestrator` ran file chunking (I/O + AST parsing) in a sequential `for...of` loop, keeping only one file in-flight at a time. Chunking is CPU/I/O-bound and embarrassingly parallel.

3. **Model cache scatter**: `virage-embedder-transformers` defaulted to `~/.cache/huggingface/hub` and `virage-embedder-fastembed` defaulted to a project-local `.virage/models` path. Models downloaded to different locations per package, couldn't be shared, and cluttered unrelated directories.

4. **Progress bar stuck at 99%**: `onProgress(final, final)` fired inside `_loadPipeline` immediately before the function returned. The render interval hadn't processed the 100% update yet when `onPreWarmDone()` switched the display phase, leaving the bar committed at 99%.

5. **GPU support missing**: `virage-embedder-transformers` accepted `"cpu" | "webgpu"` but not `"cuda"`, despite `@huggingface/transformers` supporting `"cuda"` for `onnxruntime-node` GPU builds.

### Decision

**Scanning (parallel untracked file hashing):** Before the main `getFileRevisions()` loop, identify untracked files (not in `dirtySet`, not in `treeMap`), then hash all of them concurrently with `Promise.all([...map(file => git.raw(["hash-object", file]))])`. The main loop becomes pure `Map` lookups — no subprocess spawns.

**Chunking concurrency:** Replace the sequential chunking loop with two phases:
- Phase 1: `withConcurrency(chunkTasks, chunkConcurrency)` — chunk all pending files in parallel.
- Phase 2: sequential embed/upload streaming over the collected results (streaming semantics preserved; embed batching not disrupted).

Default `chunkConcurrency` = `os.availableParallelism()` (Node 18.14+), which returns the number of logical CPU threads available to the process. Configurable via `options.chunkConcurrency`.

**Global model dir:** Add `getGlobalVirageDir(): string` to `virage-core` (`process.env["VIRAGE_GLOBAL_DIR"] ?? join(homedir(), ".virage")`). Both embedder packages default their model cache to `join(getGlobalVirageDir(), "models")` — i.e., `~/.virage/models`. Models are shared across projects and packages.

**Progress bar fix:** After firing `onProgress(final, final)`, yield to the event loop with `await new Promise<void>(resolve => setImmediate(resolve))` so the render interval gets one tick before `_loadPipeline` returns. This guarantees the bar reaches 100% before the display phase transitions.

**GPU support:** Widen `device` type in `TransformersEmbedder` to `"cpu" | "webgpu" | "cuda"`. The `createEmbedder` factory passes `"cuda"` through to `@huggingface/transformers` only when explicitly configured — requires `onnxruntime-node` with a GPU build.

### Consequences

- **+** Scanning throughput scales with `Promise.all` concurrency rather than being limited by sequential subprocess forks.
- **+** Chunking throughput scales with CPU core count (measured target: ≥10× speedup over the sequential baseline on I/O-heavy repositories).
- **+** Models shared across all virage projects at `~/.virage/models`; overridable per-deployment via `VIRAGE_GLOBAL_DIR`.
- **+** Progress bar correctly reaches 100% before the pipeline summary is shown.
- **+** CUDA GPU acceleration available for environments with the GPU `onnxruntime-node` build.
- **−** Parallel chunking is a two-phase approach (chunk-all, then stream-embed). Minor memory increase: all chunk arrays for `chunkConcurrency` files are held in memory simultaneously before embed phase starts.
- **−** `availableParallelism()` was added in Node 18.14; the call is guarded with a fallback to `os.cpus().length` for older patch versions.
- **−** `"cuda"` device requires a specific `onnxruntime-node` binary — not included in the standard install. Wrong binary selection causes a runtime error at model-load time.

---

## ADR-033: `file_revisions` table for zero-chunk file tracking

**Date:** 2026-06-20
**Status:** Accepted

### Context

`getFileStates()` in `VirageDb` returns a `Map<filePath, gitBlobSha>` by querying `chunks GROUP BY source_file`. This means only files that produced at least one chunk are present in the map. Files that are valid and tracked (e.g. short config files, `vitest.config.ts`, `CLAUDE.md`) but yield zero chunks after processing are silently absent. On every subsequent `virage index` run, `getChangedFiles()` finds them absent from `previousState` and marks them as `🆕 New`, re-chunking them unconditionally even though their content hasn't changed.

### Decision

Add a dedicated `file_revisions` table to `virage.db`:

```sql
CREATE TABLE IF NOT EXISTS file_revisions (
  source_file TEXT PRIMARY KEY,
  file_revision TEXT NOT NULL
) STRICT;
```

`replaceChunks(sourceFile, chunks, fileRevision?)` upserts into this table unconditionally — using the provided `fileRevision` (git blob SHA passed by the orchestrator) or falling back to `chunks[0].commitHash` for callers that predate the third argument. `deleteBySourceFile` deletes from both `chunks` and `file_revisions` to keep them in sync.

`getFileStates()` seeds the result map from `chunks GROUP BY source_file` (backward compat for existing DBs) then overlays entries from `file_revisions`, which takes precedence and covers zero-chunk files.

The orchestrator passes `info.commitHash` as the third argument so zero-chunk files (those whose content produces no usable chunks but are still valid tracked files) are recorded in `file_revisions` after processing.

### Consequences

- **+** Files that produce zero chunks are tracked after the first index run and not re-processed on subsequent runs.
- **+** Backward compatible: existing DBs without `file_revisions` fall back to the `chunks` query; `CREATE TABLE IF NOT EXISTS` is idempotent.
- **+** `replaceChunks` third parameter is optional — all existing call sites that don't pass it still work (they just don't benefit for zero-chunk files until migrated).
- **−** Slightly more storage: one row per tracked file in `file_revisions` on top of existing `chunks` rows.

## ADR-034: Sigmoid score calibration and candidate oversampling for cross-encoder reranker

**Date:** 2026-06-20
**Status:** Accepted

### Context

Two bugs combined to make the cross-encoder reranker produce meaningless similarity scores:

1. **Min-max normalization within the returned batch** (`reranker.ts`). After sorting candidates by raw logit, the scores were normalized as `(logit − min) / (max − min)`. The top result always received `1.0` (100%) regardless of absolute relevance. Queries like "bullshit sliding electricity" returned 100% because the most-similar vector in the index — however irrelevant — became the batch maximum.

2. **Reranker received exactly `topK` candidates to rerank, then returned `topK`**. Both `tools.ts` (MCP) and `query-cmd.ts` (CLI) fetched `topK` items from the vector store and passed the same list to the reranker. The reranker's purpose is to precision-select from a larger candidate pool; without oversampling, it was just reordering an already-final list with no selection taking place.

### Decision

**Sigmoid calibration.** Replace min-max normalization with `sigmoid(logit)` in `CrossEncoderReranker`. For ms-marco cross-encoders, the raw logit approximates log-odds of relevance; applying sigmoid gives a calibrated P(relevant | query, doc) in [0, 1] that is meaningful in absolute terms:

| logit | sigmoid | interpretation |
|-------|---------|---------------|
| +8    | ~100%   | highly relevant |
| +2    | ~88%    | probably relevant |
| −2    | ~12%    | probably not relevant |
| −8    | ~0%     | not relevant |

A single irrelevant result no longer saturates at 100%.

**Candidate oversampling.** Add `rerankOversample` (default `5`) to `RAGPipelineConfig.search` and `JsonSearchConfig`. When a reranker is configured, call sites fetch `topK × rerankOversample` candidates from the vector store before passing them all to the reranker, which then returns the best `topK`. For `topK=5` this means 25 candidates are scored by the cross-encoder.

**`minScore` threshold.** Add optional `minScore` to `CrossEncoderRerankerOptions`. Results with `sigmoid(logit) < minScore` are dropped from the output. Defaults to `0` (disabled). Operators can set e.g. `0.1` to suppress clearly irrelevant results.

### Consequences

- **+** Irrelevant queries (noise or mistyped text) now receive near-zero similarity scores instead of a misleading 100%.
- **+** The reranker actually selects from a meaningful candidate pool, improving MRR and precision@K.
- **+** `rerankOversample` is configurable per project in `virage.config.json` under `search.rerankOversample`.
- **+** `minScore` gives operators a clean way to filter garbage results without changing retrieval logic.
- **−** With `rerankOversample=5`, the cross-encoder scores 5× more (query, chunk) pairs per search. Latency increase is proportional to `rerankOversample`; the default of 5 is chosen to balance quality and latency (~50–250ms cross-encoder budget).
- **−** Single-candidate results no longer get an artificial `1.0` — they receive `sigmoid(logit)`, which may be less than 1. This is correct but changes the display for single-result searches.
