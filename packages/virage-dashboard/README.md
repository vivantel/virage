# @vivantel/virage-dashboard

[![npm version](https://img.shields.io/npm/v/@vivantel/virage-dashboard.svg)](https://www.npmjs.com/package/@vivantel/virage-dashboard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

React monitoring dashboard for the Virage RAG pipeline, served by `virage dashboard`.

## Usage

The dashboard is started automatically by the CLI:

```bash
virage dashboard
```

This serves the built `dist/` folder on a local HTTP server alongside a `/api` backend.

## Development

```bash
# In one terminal — start the virage-cli API server
cd packages/virage-cli && npm run dev

# In another terminal — start the Vite dev server (proxies /api → localhost:3000)
cd packages/virage-dashboard && npm run dev
```

## Panels

| Panel | Description |
|---|---|
| Status | Live chunk count, embedding count, and memory usage |
| Chunk histogram | Distribution of chunk sizes across the index |
| Anomalies | Embeddings with high z-scores flagged for review |

## License

MIT
