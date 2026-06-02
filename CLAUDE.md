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

### CLI (`bin/rag-update.ts`)

`rag-update --config rag.config.json` is the consumer-facing CLI. It calls `loadConfig` (reads and parses the JSON config, then dynamically imports each provider package) then `Orchestrator.run()`. Flags: `--force`, `--skip-upload`, `--chunks-file`, `--embeddings-file`.

`rag-update init` generates a `rag.config.json` interactively (`src/cli/init.ts`). It scans the working directory for known file types, presents a pre-checked confirmation prompt, generates chunkers using the strategy shorthand, and prompts for secrets to write to `.env`. After secrets, it detects the project's package manager and offers to auto-install required packages. Falls back to manual strategy selection if no known types are found. Known extension groups: `.md`/`.mdx` → `markdownHeadersStrategy`, `.ts`/`.tsx`/`.js`/`.jsx`/`.py`/`.go`/`.cs`/`.java` → `tokenStrategy`, `.yaml`/`.yml` → `wholeFileStrategy`, `.txt` → `semanticStrategy`. Embedder and store choices are driven by `loadRegistry()` (see plugin registry above), so external plugins appear automatically. Built-in stores: `postgres`, `qdrant`, `lancedb`, `chromadb`, `custom`.

**Config file loading** (`src/config-loader.ts`): Only JSON configs are supported. `loadConfig()` reads and parses the JSON, validates the schema, expands `${ENV_VAR}` placeholders, and dynamically imports each `embedder.package` / `vectorStore.package` calling its `createEmbedder()` / `createVectorStore()` factory. Passing a `.ts` path throws a `ConfigError` with a migration suggestion.

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

**Intermediate artifacts**: `docs/rag/chunks.json` and `docs/rag/embeddings.json` are gitignored — they are generated by the pipeline and cached in CI via `actions/cache`. `rag.config.ci.json` at the repo root is the CI-specific config (FastEmbed embedder + Postgres vector store) used by `.github/workflows/rag-update.yaml` — a standalone workflow that triggers on master pushes and installs published packages from npmjs rather than building from source.

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

`rag-embedder-openai` and `rag-embedder-transformers` are excluded from `type-check:ci` because their third-party type declaration files (`openai/index.d.mts`, `@huggingface/transformers/types/transformers.d.ts`) are empty in this environment — a corrupted npm install that predates this project. Run `npm ci` in those packages to restore them.

## Release process

Releases are automated via release-please (`.github/workflows/release.yaml`). Commit messages must follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.) — this drives version bumping and CHANGELOG generation. The `prepublishOnly` script runs `build && test` before any publish.
