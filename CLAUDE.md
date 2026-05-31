# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # compile TypeScript to dist/
npm run build:clean    # rm -rf dist && build
npm test               # run all tests
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
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

This is an ESM TypeScript library (`type: module`, NodeNext module resolution) published as `@vivantel/rag-core`. It provides a four-stage RAG pipeline that consumers wire together via a config file.

### Pipeline stages (all in `src/core/`)

1. **GitTracker** — uses `simple-git` + `glob` to find files matching chunker patterns, computes per-file commit hashes for change detection. Appends `-dirty` to hashes when there are uncommitted changes.

2. **ChunkProcessor** — runs each file through its matched `FileChunker`, adds `contentHash` (SHA-256 first 16 chars) to each chunk, persists to `chunks.json`.

3. **EmbedderProcessor** — reads `chunks.json`, skips chunks whose `contentHash` already appears in `embeddings.json` (incremental), calls `EmbeddingProvider.embed()` or `embedBatch()`, writes `embeddings.json`.

4. **Uploader** — reads `embeddings.json`, compares against vector store state via `VectorStore.getCurrentState()`, calls `deleteBySourceFile()` then `upsert()` for changed sources.

**Orchestrator** (`src/core/orchestrator.ts`) wires all four stages and is the main entry point for consumers. Default intermediate file paths are `./docs/rag/chunks.json` and `./docs/rag/embeddings.json`.

### Interfaces (`src/interfaces/`)

Three provider interfaces consumers must implement:
- `FileChunker` — `chunk(filePath, commitHash): Promise<Chunk[]>` plus `patterns: string[]`
- `EmbeddingProvider` — `embed(text): Promise<number[]>`, optional `embedBatch`
- `VectorStore` — `initialize`, `upsert`, `deleteBySourceFile`, `getCurrentState`, `search`

### Strategies (`src/strategies/chunk/`)

Four built-in `ChunkStrategy` implementations returned as factory functions: `tokenStrategy`, `markdownHeadersStrategy`, `semanticStrategy`, `wholeFileStrategy`. Strategies produce `Chunk[]` from raw text; they are lower-level than `FileChunker` — use `createChunker` to compose them.

### `createChunker` helper (`src/helpers/create-chunker.ts`)

Wraps the `FileChunker` interface: accepts a `process(content, filePath, commitHash)` callback so consumers write a plain function instead of implementing the full interface. `canProcess` is optional.

### CLI (`bin/rag-update.ts`)

`rag-update --config rag.config.ts` is the consumer-facing CLI. It calls `loadConfig` (dynamic `import()` of the config file) then `Orchestrator.run()`. Flags: `--force`, `--skip-upload`, `--chunks-file`, `--embeddings-file`.

### Module import style

All internal imports use `.js` extensions (NodeNext requirement), e.g. `from "./git-tracker.js"` even though files are `.ts`. Keep this convention when adding new imports.

## Release process

Releases are automated via release-please (`.github/workflows/release.yaml`). Commit messages must follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.) — this drives version bumping and CHANGELOG generation. The `prepublishOnly` script runs `build && test` before any publish.
