# @vivantel/virage-store-lancedb

[![npm](https://img.shields.io/npm/v/@vivantel/virage-store-lancedb.svg)](https://www.npmjs.com/package/@vivantel/virage-store-lancedb)

LanceDB vector store for [`@vivantel/virage-core`](../rag-core/README.md). Embedded and file-based — no server required. Data lives in a local directory (or LanceDB Cloud with an API key).

## Installation

```bash
npm install @vivantel/virage-store-lancedb @vivantel/virage-core
```

## Quick start (JSON config)

Local file storage — no server needed:

```json
{
  "vectorStore": {
    "package": "@vivantel/virage-store-lancedb",
    "config": {
      "uri": "./lancedb"
    }
  }
}
```

## LanceDB Cloud

Pass your LanceDB Cloud URI and API key:

```json
{
  "vectorStore": {
    "package": "@vivantel/virage-store-lancedb",
    "config": {
      "uri": "db://my-project",
      "apiKey": "${LANCEDB_API_KEY}"
    }
  }
}
```

## Configuration

| Option       | Type     | Default       | Description                                                  |
| ------------ | -------- | ------------- | ------------------------------------------------------------ |
| `uri`        | `string` | **required**  | Local path (`"./lancedb"`) or LanceDB Cloud URI (`"db://…"`) |
| `apiKey`     | `string` | `undefined`   | LanceDB Cloud API key                                        |
| `tableName`  | `string` | `"documents"` | Table name inside the database                               |
| `dimensions` | `number` | `1536`        | Vector size — must match your embedder                       |

## TypeScript usage

```typescript
import { LanceDBVectorStore } from "@vivantel/virage-store-lancedb";

const store = new LanceDBVectorStore({
  uri: "./lancedb",
  tableName: "my-docs",
  dimensions: 1536,
});
```

## Self-registration

This package declares a `"rag-plugin"` field in its `package.json`. Once installed, `virage init` discovers it automatically — no manual config required.

```jsonc
// package.json (excerpt)
"rag-plugin": {
  "type": "vectorStore",
  "label": "LanceDB (embedded, file-based)",
  "key": "lancedb",
  "envVars": [],
  "defaultConfig": { "uri": "./lancedb" }
}
```
