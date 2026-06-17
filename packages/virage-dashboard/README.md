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
| Home        | Live chunk count, embedding count, memory usage, chunk histogram, anomaly table    |
| Chunks      | Browse and delete individual chunks by source file                                 |
| Search      | Interactive semantic search against the indexed knowledge base                     |
| Pipeline    | Trigger index updates, generate eval datasets, and run evaluations via WebSocket   |
| Experiments | View and compare saved evaluation runs                                             |
| Analytics   | Query history, top search terms, zero-result queries, queries-per-hour chart       |

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

## License

MIT
