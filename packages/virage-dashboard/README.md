# @vivantel/virage-dashboard

[![npm version](https://img.shields.io/npm/v/@vivantel/virage-dashboard.svg)](https://www.npmjs.com/package/@vivantel/virage-dashboard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

React monitoring dashboard for the Virage RAG pipeline, served by `virage dashboard`.

## Usage

```bash
virage dashboard                  # start on port 3000
virage dashboard --port 8080      # custom port
virage dashboard --verbose        # log every HTTP request (useful for debugging)
```

The CLI prints the UI path and database status on startup. If the UI is missing it
serves an actionable build-instructions page instead of a blank screen.

## Pages

| Page        | Description                                                                        |
| ----------- | ---------------------------------------------------------------------------------- |
| Home        | Live chunk count, embedding count, memory usage, chunk-size histogram (from vector DB), anomaly table |
| Chunks      | Browse and delete individual chunks by source file                                 |
| Search      | Semantic search with extended chunk info: `denseText`, `sparseText`, metadata key-value pairs, generator IDs; virtual scroll; sort by similarity or chunk size |
| Pipeline    | Trigger pipeline operations via WebSocket (`index`, `eval-generate`, `eval-run`); shared `PipelineLog` component shows live progress |
| Experiments | View, compare, and delete saved evaluation runs; `PipelineLog` appears only for `eval-save` / `eval-run` ops — pipeline index logs are filtered out |
| Analytics   | Query history, top search terms, zero-result queries, queries-per-hour chart       |

## Data sources

| Data | Source |
|------|--------|
| Chunk text, vectors, metadata | **LanceDB** (`vectorStore.listAll()` / `vectorStore.search()`) |
| Chunk-size histogram | Computed from LanceDB data; empty-state card shown before first `virage index` |
| System stats, analytics, experiment runs | SQLite (`VirageDb`) |

All endpoints fall back to SQLite when a vector store config is unavailable.

## Search page

Results include all fields stored in LanceDB:
- **denseText** — the embedding-target text (displayed by default)
- **sparseText** — BM25 tokens (visible on expand)
- **metadata** — key-value pairs from the chunker (expand to see)
- **sparseTextGeneratorId / metadataGeneratorId** — chunker fingerprints (expand to see)
- **sourceFile** and **similarity %** — always visible in collapsed card

Results can be sorted by **Vector Similarity** (default) or **Chunk Size**.

## Pipeline log

The shared `PipelineLog` component (`src/components/PipelineLog.tsx`) renders WebSocket progress messages and is used by both Pipeline and Experiments pages. It filters by `currentOp` — the Experiments log only shows `eval-save` and `eval-run` ops; pipeline ops (`index`, `eval-generate`) do not appear there.

## Development

```bash
# In one terminal — start the virage-cli API server
cd packages/virage-cli && npx tsx src/bin/virage.ts dashboard

# In another terminal — start the Vite dev server (proxies /api and /ws → localhost:3000)
cd packages/virage-dashboard && npm run dev
```

Rebuild the production bundle and embed it in virage-cli:

```bash
npm run build:with-dashboard -w @vivantel/virage-cli
```

## Testing

```bash
npm test                          # unit tests (vitest)
npm run test:e2e                  # E2E tests (playwright; starts dev server automatically)
npm run type-check                # TypeScript
```

See [`docs/ai/guardrails/dashboard.md`](../../docs/ai/guardrails/dashboard.md) for architecture, component conventions, and testing patterns.

## License

MIT
