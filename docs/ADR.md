# Architecture Decision Records

This document captures the key architectural decisions made in the `@vivantel/rag-core` project. Each entry follows the standard ADR format: Status, Context, Decision, and Consequences.

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
- Strategies were later extracted to `@vivantel/rag-strategies` (ADR-008).

---

## ADR-007: `tsx` for zero-build TypeScript config loading

**Date:** 2026-05-31  
**Status:** Accepted

### Context
Consumer config files (`rag.config.ts`) are TypeScript. If consumers had to compile their config to JS before running the CLI, the DX would be painful. We need to load `.ts` files at runtime without requiring consumers to configure `ts-node` or Node's `--experimental-transform-types` flag.

### Decision
`loadConfig()` detects `.ts` extensions and loads them via `tsImport()` from `tsx/esm/api` (a runtime dependency). Plain `.js` configs use native `import()`. Consumers write TypeScript configs; no build step required.

### Consequences
- **+** `rag.config.ts` is ergonomic and type-safe for consumers.
- **+** Consumers get editor autocompletion on the config type.
- **−** `tsx` is a runtime dependency (not devDependency), increasing the installed footprint.
- **−** `tsx` transformation is a silent step; debugging config syntax errors can be confusing.
- Partially addressed by adding JSON config support as an alternative (ADR-011).

---

## ADR-008: Monorepo with per-package CI and independent versioning

**Date:** 2026-06-01  
**Status:** Accepted

### Context
Provider implementations (embedders, vector stores) have incompatible peer dependencies (e.g. `fastembed` vs `openai` vs `@xenova/transformers`). Shipping all of them inside `rag-core` would force consumers to install every provider's dependency tree regardless of which they use.

### Decision
Convert the repository to an npm workspaces monorepo (`packages/*`). Each provider is a separate package with its own `package.json`, CI workflow, CHANGELOG, and semver version:

| Package | Role |
|---|---|
| `@vivantel/rag-core` | Pipeline engine + interfaces + CLI |
| `@vivantel/rag-strategies` | Built-in chunk strategies (re-export, strategies deprecated in core) |
| `@vivantel/rag-embedder-openai` | OpenAI embedding provider |
| `@vivantel/rag-embedder-fastembed` | FastEmbed (local) provider |
| `@vivantel/rag-embedder-transformers` | Hugging Face Transformers provider |
| `@vivantel/rag-store-postgres` | PostgreSQL + pgvector store |

`release-please` is configured in manifest mode to publish each package independently.

### Consequences
- **+** Consumers install only the providers they use.
- **+** Provider packages can ship breaking changes without bumping `rag-core`.
- **+** Per-package CI catches regressions in isolation.
- **−** Contributors must understand npm workspaces and cross-package build order.
- **−** `rag-core` must be built before dependent packages can type-check.
- **−** Release-please configuration is non-trivial; manifest mode required several iteration fixes.

---

## ADR-009: `rag.config.ts` is gitignored; `rag.config.ci.json` is tracked

**Date:** 2026-06-01  
**Status:** Accepted

### Context
`rag.config.ts` contains provider credentials (API keys via environment references), path configurations, and project-specific chunker setups. Committing it risks leaking credentials and creates merge conflicts across forks.

### Decision
Add `rag.config.ts` to `.gitignore`, treating it like `.env`. The CI-specific config (`rag.config.ci.json`) is tracked because it is infrastructure-as-code — it references published package names and no secrets directly (credentials come from GitHub Actions secrets via `${VAR}` expansion at runtime).

### Consequences
- **+** No accidental credential commits.
- **+** Each consumer's config is tailored to their project without merge friction.
- **−** New contributors must run `rag-update init` or manually create the config — not apparent from a `git clone`.
- Documentation in README and `rag-update init` mitigates this.

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

A JSON Schema is published at `schemas/rag.config.schema.json` for editor validation. `autoDetectConfig()` prefers `rag.config.json` over `rag.config.ts` when both exist.

### Consequences
- **+** CI config is declarative, schema-validated, and credential-free.
- **+** Reduces friction for non-TypeScript environments.
- **−** JSON config cannot express custom chunker logic — only built-in strategies. Complex use cases still require TypeScript.
- **−** Two config formats increase the surface area of `loadConfig()`.

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
Extract the RAG pipeline into a dedicated workflow (`.github/workflows/rag-update.yaml`) that:
1. Installs `@vivantel/rag-core` and companion packages from the published npm registry (not from source).
2. Uses `rag.config.ci.json` (tracked, schema-validated).
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
Replace `@vivantel/rag-store-supabase` with `@vivantel/rag-store-postgres`, which connects directly to PostgreSQL via `pg` + `pgvector`. The new package exposes `createVectorStore(config)` compatible with the JSON config format (ADR-011). Connection details are passed via environment variables expanded at load time.

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
