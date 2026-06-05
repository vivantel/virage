# @vivantel/virage-store-chromadb

[![npm](https://img.shields.io/npm/v/@vivantel/virage-store-chromadb.svg)](https://www.npmjs.com/package/@vivantel/virage-store-chromadb)

ChromaDB vector store for [`@vivantel/virage-core`](../rag-core/README.md). Works with a locally-running Chroma server or hosted Chroma Cloud.

## Installation

```bash
npm install @vivantel/virage-store-chromadb @vivantel/virage-core
```

## Quick start (JSON config)

Local Chroma server:

```json
{
  "vectorStore": {
    "package": "@vivantel/virage-store-chromadb",
    "config": {
      "path": "http://localhost:8000"
    }
  }
}
```

## Running Chroma locally

```bash
docker run -p 8000:8000 chromadb/chroma
```

## Hosted Chroma

Pass your Chroma Cloud URL and API key:

```json
{
  "vectorStore": {
    "package": "@vivantel/virage-store-chromadb",
    "config": {
      "path": "${CHROMA_URL}",
      "apiKey": "${CHROMA_API_KEY}"
    }
  }
}
```

## Configuration

| Option           | Type     | Default                   | Description                                         |
| ---------------- | -------- | ------------------------- | --------------------------------------------------- |
| `path`           | `string` | `"http://localhost:8000"` | Chroma server URL                                   |
| `apiKey`         | `string` | `undefined`               | API key for hosted Chroma (token auth)              |
| `collectionName` | `string` | `"documents"`             | Collection name                                     |
| `dimensions`     | `number` | `undefined`               | Vector size (inferred from first upsert if omitted) |

## TypeScript usage

```typescript
import { ChromaVectorStore } from "@vivantel/virage-store-chromadb";

const store = new ChromaVectorStore({
  path: "http://localhost:8000",
  collectionName: "my-docs",
});
```

## Self-registration

This package declares a `"rag-plugin"` field in its `package.json`. Once installed, `virage init` discovers it automatically — no manual config required.

```jsonc
// package.json (excerpt)
"rag-plugin": {
  "type": "vectorStore",
  "label": "ChromaDB (local or hosted)",
  "key": "chromadb",
  "envVars": [],
  "defaultConfig": { "path": "http://localhost:8000" }
}
```
