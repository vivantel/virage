---
name: virage-dev
description: Guide for developing virage internals — adding plugins, modifying the orchestrator or config schema, navigating ADR requirements, and maintaining CI discipline.
license: MIT
when_to_use:
  - "Adding a new embedder, chunker, vector store, or reranker plugin"
  - "Modifying virage-core orchestrator, config schema, or pipeline interfaces"
  - "Deciding whether an ADR is needed for a proposed change"
  - "Touching the search path (tools.ts, query-cmd.ts, handleSearch)"
  - "Debugging CI failures or understanding the monorepo build/test/lint flow"
  - "Understanding the chunk lifecycle: chunking → embedding → uploading → querying"
prerequisites: []
estimated_tokens: 900
output_format: "Inline guidance — no plan file needed unless the change is multi-step"
metadata:
  author: vivantel-team
  version: "1.0.0"
---

# Skill: Virage Dev

**Purpose:** Navigate virage internals confidently — know where to change things, when an ADR is required, and how to keep CI green.

---

## Architecture in 60 seconds

```
virage.config.json
  └── config-loader.ts          resolves plugins, builds RAGPipelineConfig
        └── orchestrator.ts     runs: git-track → chunk → embed → upload
              ├── chunk-processor.ts   calls FileChunker per fileset
              ├── embedder.ts          batches & rate-limits EmbeddingProvider calls
              └── uploader.ts          deduplicates by denseTextHash, uploads to VectorStore

virage query → query-cmd.ts → EmbeddingProvider.embed() → VectorStore.search()
                            → (optional) Reranker.rerank()
                            → (optional) minSimilarity filter
                            → (optional) session dedup via session-state.ts
```

Key interfaces (all in `packages/virage-core/src/interfaces/`):
- `EmbeddingProvider` — `embed(text): Promise<number[]>`, `dimensions: number`
- `FileChunker` — `chunk(file, content): Promise<Chunk[]>`
- `VectorStore` — `search(embedding, topK, filter?, opts?): Promise<VectorSearchResult[]>`
- `Reranker` — `rerank(query, results, topK): Promise<VectorSearchResult[]>`

Plugin factory convention: every plugin package exports `createEmbedder(opts)` / `createChunker(opts)` / `createVectorStore(opts)` / `createReranker(opts)`.

---

## Adding a new plugin

1. Create `packages/virage-{type}-{name}/src/` with the implementation
2. Export `createXxx(opts: Record<string, unknown>): XxxInterface` as the package entry point
3. Optionally export `optionsSchema: ZodSchema` — config-loader validates it automatically
4. Add to `pnpm-workspace.yaml` if it's a new workspace package
5. No registration needed beyond the user's `virage.config.json` — the plugin system is pure dynamic import

---

## Config schema changes

Four files must stay in sync:
1. `packages/virage-core/src/config-schema.ts` — Zod schema (source of truth)
2. `packages/virage-core/src/config-loader.ts` — resolves new field, passes to `RAGPipelineConfig`
3. `packages/virage-core/src/core/orchestrator.ts` — `RAGPipelineConfig` TypeScript interface
4. `packages/virage-core/schemas/virage.config.schema.json` — hand-maintained JSON Schema for IDE autocomplete

---

## ADR gate

Write an ADR in `docs/decisions/ADR-NNN-title.md` when:
- Adding or removing a field from a public interface (`EmbeddingProvider`, `VectorStore`, `Chunk`, etc.)
- Changing search algorithm behavior (scoring, dedup logic, reranking contract)
- Adding a new top-level config field
- Changing chunk storage format or hash strategy

Skip ADR for: internal refactors with no interface impact, bug fixes, new plugin packages.

---

## Commit discipline

- `pnpm -w format && pnpm -w lint && pnpm -w typecheck` — run from repo root before every commit
- Commit type matters for release-please:
  - `fix:` → patch release
  - `feat:` → minor release
  - `style:` → **skipped by release-please** — use `fix:` for CI-breaking format/lint fixes
- Never skip hooks (`--no-verify`)
- Re-run checks after every `git pull` — release-please merges frequently

---

## Common file locations

| What | Where |
|---|---|
| Core interfaces | `packages/virage-core/src/interfaces/` |
| Orchestrator | `packages/virage-core/src/core/orchestrator.ts` |
| Config schema (Zod) | `packages/virage-core/src/config-schema.ts` |
| Config loader | `packages/virage-core/src/config-loader.ts` |
| JSON Schema | `packages/virage-core/schemas/virage.config.schema.json` |
| CLI query command | `packages/virage-cli/src/cli/query-cmd.ts` |
| MCP search handler | `packages/virage-mcp/src/tools.ts` |
| Claude Code hook | `packages/virage-agent-claude/src/plugin.ts` |
| Session dedup util | `packages/virage-cli/src/cli/session-state.ts` |
| ADRs | `docs/decisions/` |
| Eval suites | `eval/suites/*.suite.json` |
