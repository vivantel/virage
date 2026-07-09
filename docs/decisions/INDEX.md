# Architecture Decision Records

| ID | Title | Status | Summary | Path |
|----|-------|--------|---------|------|
| ADR-001 | ESM-only TypeScript package | Accepted | ESM-only package with NodeNext resolution; no CJS build | [ADR-001](./ADR-001-esm-first-typescript.md) |
| ADR-002 | Four-stage pipeline | Accepted | GitTracker → ChunkProcessor → EmbedderProcessor → Uploader orchestration | [ADR-002](./ADR-002-four-stage-pipeline.md) |
| ADR-003 | Consumer/provider interfaces | Accepted | `FileChunker`, `EmbeddingProvider`, `VectorStore` as the three core contracts | [ADR-003](./ADR-003-consumer-provider-interfaces.md) |
| ADR-004 | Git commit hash change detection | Accepted | Per-file git blob SHA for change detection; `-dirty` suffix for uncommitted changes | [ADR-004](./ADR-004-git-commit-hash-change-detection.md) |
| ADR-005 | Content hash embedding skip | Accepted | SHA-256 `contentHash` for chunk-level dedup; skip re-embedding unchanged chunks | [ADR-005](./ADR-005-content-hash-embedding-skip.md) |
| ADR-006 | Strategy pattern for chunking | Superseded | `ChunkStrategy` + `FileChunker` + `createChunker` factory pattern — superseded by ADR-039 | [ADR-006](./ADR-006-strategy-pattern-chunking.md) |
| ADR-007 | tsx TypeScript config loading | Superseded | `tsx` runtime for `.ts` configs — superseded by JSON-only config (ADR-035) | [ADR-007](./ADR-007-tsx-typescript-config-loading.md) |
| ADR-008 | Monorepo with independent versioning | Accepted | npm workspaces monorepo; release-please manifest per package | [ADR-008](./ADR-008-monorepo-independent-versioning.md) |
| ADR-009 | gitignore for rag config | Accepted | `rag.config.ts` gitignored; `virage.config.ci.json` tracked for CI | [ADR-009](./ADR-009-gitignore-rag-config.md) |
| ADR-010 | Telemetry opt-in | Accepted | `TelemetryCollector` is opt-in; nullable reference; no tracking without explicit config | [ADR-010](./ADR-010-telemetry-opt-in.md) |
| ADR-011 | JSON config with env-var expansion | Accepted | `loadJsonConfig` with `${VAR}` expansion and JSON Schema validation | [ADR-011](./ADR-011-json-config-env-var-expansion.md) |
| ADR-012 | Model dimensions mismatch re-embed | Accepted | `EmbeddingsMeta` header; full re-embed triggered automatically on model/dimension change | [ADR-012](./ADR-012-model-dimensions-mismatch-reembed.md) |
| ADR-013 | Plugin discovery via npm exports | Accepted | `discoverPlugins()` finds plugins via `ragPlugin`/`ragPlugins` named exports | [ADR-013](./ADR-013-plugin-discovery-npm-exports.md) |
| ADR-014 | Standalone CI workflow | Accepted | Dedicated `.github/workflows/virage.yaml` using published npm packages, not source | [ADR-014](./ADR-014-standalone-ci-workflow.md) |
| ADR-015 | Postgres/pgvector canonical store | Accepted | Replace `virage-store-supabase` with `virage-store-postgres` using direct `pg`+pgvector | [ADR-015](./ADR-015-postgres-pgvector-canonical-store.md) |
| ADR-016 | Automated releases with release-please | Accepted | release-please + Conventional Commits + npm OIDC provenance | [ADR-016](./ADR-016-automated-releases-release-please.md) |
| ADR-017 | Logger abstraction with consola | Accepted | `Logger` interface with `ConsolaLogger`/`NullLogger`; stackable `-v` flag | [ADR-017](./ADR-017-logger-abstraction-consola.md) |
| ADR-018 | Vitest acceptance test suite | Accepted | Vitest-based acceptance suite in `test/acceptance/`; replaces shell e2e script | [ADR-018](./ADR-018-vitest-acceptance-test-suite.md) |
| ADR-019 | virage-store-test private package | Accepted | Private `@vivantel/virage-store-test` workspace package for acceptance tests; no `rag-plugin` field | [ADR-019](./ADR-019-virage-store-test-private-package.md) |
| ADR-020 | virage index subcommand | Accepted | Pipeline moved to `virage index` subcommand; bare `virage` shows help | [ADR-020](./ADR-020-virage-index-subcommand.md) |
| ADR-021 | SQLite embeddings storage | Accepted | Replace `embeddings.json` with SQLite (`better-sqlite3`); `uploaded` flag for partial upload tracking | [ADR-021](./ADR-021-sqlite-embeddings-storage.md) |
| ADR-022 | Mid-run partial uploads | Accepted | `onIntermediateBatch` callback + `minIngestionBatchSize` for streaming ingestion | [ADR-022](./ADR-022-mid-run-partial-uploads.md) |
| ADR-023 | Fail-fast vector store errors | Accepted | `isFatalVectorStoreError` regex skips retry for schema/auth errors | [ADR-023](./ADR-023-fail-fast-vector-store-errors.md) |
| ADR-024 | Split virage-core into library + CLI + dashboard | Accepted | `virage-core` (library) + `virage-cli` (binary) + `virage-dashboard` (React+Vite) | [ADR-024](./ADR-024-split-virage-core-cli-dashboard.md) |
| ADR-025 | Universal agent hook base package | Accepted | `virage-agent-core` with `NormalizedEventName`, `VendorConfig`, `BaseAgentPlugin` abstract class | [ADR-025](./ADR-025-universal-agent-hook-base.md) |
| ADR-026 | Static-file copier agent plugins | Accepted | Plugins ship static `plugin-config/` dirs; `BaseAgentPlugin.configure()` copies them to target | [ADR-026](./ADR-026-static-file-copier-agent-plugins.md) |
| ADR-027 | list_skills SkillMeta response | Accepted | `list_skills` returns `SkillMeta[]` with `when_to_use`, `prerequisites`, `estimated_tokens`; `schema_version: 2` | [ADR-027](./ADR-027-list-skills-skillmeta-response.md) |
| ADR-028 | Branch-aware RAG | Accepted | Single DB with branch metadata tagging; per-file dirty detection; `virage query` CLI; `virage install-hooks` | [ADR-028](./ADR-028-branch-aware-rag.md) |
| ADR-029 | No native subagents for skills | Accepted | Keep static `.md` skill model for all 4 agents; vendor parity over Claude-only subagent dispatch | [ADR-029](./ADR-029-no-native-subagents-skills.md) |
| ADR-030 | Semver ranges in peerDependencies | Accepted | Published packages declare virage deps as `peerDependencies` with `>=X.Y.Z <X.(Y+1).0` | [ADR-030](./ADR-030-semver-ranges-peer-dependencies.md) |
| ADR-031 | chunking config section + ignore patterns | Superseded | Superseded by ADR-043 (fileSets). `chunking.ignore` global patterns — no longer used. | [ADR-031](./ADR-031-chunking-config-exclude-patterns.md) |
| ADR-032 | Scanning/chunking performance | Accepted | Parallel untracked hashing; `withConcurrency` chunking; `~/.virage/models` global cache; CUDA support | [ADR-032](./ADR-032-scanning-chunking-performance.md) |
| ADR-033 | file_revisions table | Accepted | `file_revisions` SQLite table tracks zero-chunk files so they aren't re-processed | [ADR-033](./ADR-033-file-revisions-zero-chunk-tracking.md) |
| ADR-034 | Sigmoid score calibration | Accepted | `sigmoid(logit)` replaces min-max normalization; `rerankOversample` default 5; `minScore` threshold | [ADR-034](./ADR-034-sigmoid-score-calibration.md) |
| ADR-035 | JSON-only config | Accepted | Remove TypeScript config loading; `.ts` path raises `ConfigError`; `tsx` moved to devDeps | [ADR-035](./ADR-035-json-only-config.md) |
| ADR-036 | ArtifactSet structure and on-the-fly context assembly | Accepted | Remove stored `contextText`; assemble context at query time from `denseText`, `metadata.parentId`, `metadata.siblingIds` | [ADR-036](./ADR-036-artifactset-structure-caching.md) |
| ADR-037 | Per-chunk generator IDs for incremental rebuilding | Accepted | `sparseTextGeneratorId` and `metadataGeneratorId` stored per-chunk as method fingerprints; enable targeted rebuild when configuration changes | [ADR-037](./ADR-037-generator-ids-incremental-rebuilding.md) |
| ADR-038 | Package-based chunker configuration | Accepted | Replace `strategy`+`patterns` with `package`+`version`+`options`; breaking change, no migration path | [ADR-038](./ADR-038-package-based-chunker-config.md) |
| ADR-039 | Plugin-only chunkers and virage-strategies deprecation | Superseded | Superseded by ADR-043 (fileSets). Three-field flat model still applies; `chunking.chunkers` replaced by `fileSets`. | [ADR-039](./ADR-039-plugin-only-chunkers-virage-strategies-deprecation.md) |
| ADR-040 | Quality system — CLI consolidation and 26-metric self-assessment | Accepted | Merge eval/eval-suite/benchmark into `virage quality`; 26-metric intrinsic self-assessment; RAGBench alongside JSON datasets; benchmark-action history | [ADR-040](./ADR-040-quality-system.md) |
| ADR-041 | Unified PluginRef shape | Accepted | All plugin blocks use `{ package, packageVersion?, options? }`; `config` removed; `pluginVersions` removed | [ADR-041](./ADR-041-unified-plugin-ref-shape.md) |
| ADR-042 | VirageDb idempotent migrations | Accepted | `schema_migrations` table + numbered MIGRATIONS array; forward-only; deprecated entities get DDL comments | [ADR-042](./ADR-042-virage-db-idempotent-migrations.md) |
| ADR-043 | FileSets as first-class config entities | Accepted | `fileSets` replaces `chunking`; named scopes with tags, tagRules, multi-chunker | [ADR-043](./ADR-043-filesets-config-entities.md) |
| ADR-044 | ChunkerKey in ChunkMeta | Accepted | `ChunkMeta.chunkerKey?: string` stores producing chunker package name | [ADR-044](./ADR-044-chunker-key-chunk-meta.md) |
| ADR-045 | Chunk output templates (design + stub) | Accepted | Per-chunker `templates: { denseText?, sparseText? }` with inline or file minijinja; impl deferred | [ADR-045](./ADR-045-chunk-output-templates-design.md) |
| ADR-046 | Tags as the unified metadata vocabulary | Accepted | `labels` → `tags` everywhere; `LabelRule` → `TagRule`; `labelFilter` → `tagFilter` | [ADR-046](./ADR-046-tags-metadata-vocabulary.md) |
| ADR-047 | Plugin options schema convention | Accepted | Every plugin exports `optionsSchema: ZodType`; config loader validates before instantiation | [ADR-047](./ADR-047-plugin-options-schema.md) |
| ADR-048 | Native package platform support | Accepted | napi-rs platform stubs + `optionalDependencies`; release-please `extra-files` for version sync | [ADR-048](./ADR-048-native-package-platform-support.md) |
| ADR-049 | Source content streaming via SourceProvider | Accepted | `readContent(path, opts?)` on `SourceProvider`; optional on `SourceRepository`; enables S3/CDN providers and byte-range chunking | [ADR-049](./ADR-049-source-content-streaming.md) |
| ADR-050 | Linux native packages built with cargo-zigbuild | Accepted | `cargo-zigbuild` targeting glibc 2.17 for linux-x64-gnu; eliminates `__isoc23_*` symbol failures | [ADR-050](./ADR-050-linux-native-glibc-target.md) |
| ADR-051 | virage-engine Rust monolith | Accepted | Consolidates 6 napi-rs packages into one Rust binary crate; feature-gated modules; 4-platform CI | [ADR-051](./ADR-051-virage-engine-rust-monolith.md) |
| ADR-052 | WASM Component Model plugin host | Accepted | wasmtime + WASI preview2; WIT worlds (chunker/embedder/reranker/source); sandboxed, language-agnostic | [ADR-052](./ADR-052-wasm-plugin-host.md) |
| ADR-053 | Full Rust tokio pipeline | Accepted | Replaces TypeScript orchestrator; `SourceProvider` trait; `walkToChunks` port; tokio bounded-channel back-pressure | [ADR-053](./ADR-053-full-rust-pipeline.md) |
| ADR-054 | Multi-worker pipeline concurrency via bounded tokio channels | Accepted | N tokio worker tasks + bounded mpsc channels; `--workers N` flag; back-pressure via channel capacity | [ADR-054](./ADR-054-pipeline-concurrency.md) |
