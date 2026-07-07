# Skill: Virage Dev (summary)

Use when: modifying virage internals, adding a plugin (embedder/chunker/vector store/reranker), touching virage-core orchestrator or config schema, or deciding whether an ADR is needed.

**Full skill cost:** ~900 tokens. Load with `read_skill('virage-dev')` for the full guide.

## Quick reference
- New plugin → implement the interface in `packages/virage-core/src/interfaces/`, register factory as `createEmbedder` / `createChunker` / `createVectorStore` / `createReranker`
- Config change → update `config-schema.ts` (Zod) + `config-loader.ts` + JSON schema file + `RAGPipelineConfig` in `orchestrator.ts`
- ADR gate → interface additions/removals, new config fields, search algorithm changes need an ADR in `docs/decisions/`
- Before every commit → `pnpm -w format && pnpm -w lint && pnpm -w typecheck` from repo root
- Commit type → use `fix` not `style` for CI-breaking format/lint fixes; `style` skips release-please
