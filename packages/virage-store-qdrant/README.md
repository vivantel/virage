# @vivantel/virage-store-qdrant

Qdrant vector store for [`@vivantel/virage-core`](../rag-core/README.md). Works with both local Qdrant instances and Qdrant Cloud (SaaS).

## Installation

```bash
npm install @vivantel/virage-store-qdrant @vivantel/virage-core
```

## Quick start (JSON config)

```json
{
  "vectorStore": {
    "package": "@vivantel/virage-store-qdrant",
    "config": {
      "url": "${QDRANT_URL}",
      "apiKey": "${QDRANT_API_KEY}"
    }
  }
}
```

For a local instance (no API key required):

```json
{
  "vectorStore": {
    "package": "@vivantel/virage-store-qdrant",
    "config": {
      "url": "http://localhost:6333"
    }
  }
}
```

## Configuration

| Option       | Type     | Default       | Description                            |
| ------------ | -------- | ------------- | -------------------------------------- |
| `url`        | `string` | **required**  | Qdrant instance URL                    |
| `apiKey`     | `string` | `undefined`   | API key for Qdrant Cloud               |
| `collection` | `string` | `"documents"` | Collection name                        |
| `dimensions` | `number` | `1536`        | Vector size — must match your embedder |

## TypeScript usage

```typescript
import { QdrantVectorStore } from "@vivantel/virage-store-qdrant";

const store = new QdrantVectorStore({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY,
  collection: "my-docs",
  dimensions: 1536,
});
```

## Observability (ROADMAP v2)

### Index stats (`virage store stats`)

```typescript
const stats = await store.getIndexStats();
// {
//   totalVectors: 12500,
//   indexType: "hnsw",
//   annRecallAt10: 0.96,
//   indexAgeHours: 0,
//   deadTupleFraction: 0,
//   suggestions: ["Collection looks healthy"]
// }
```

### Query performance (`virage store perf --timeframe 24`)

```typescript
const perf = await store.getQueryPerfReport(24);
// {
//   timeframeHours: 24,
//   p50LatencyMs: 3.2,
//   p95LatencyMs: 8.7,
//   p99LatencyMs: 14.1,
//   slowQueryCount: 0,
//   suggestedIndexes: ["Query performance looks healthy."]
// }
```

Query performance metrics require Qdrant's `/metrics` endpoint to be reachable. Metrics are returned as `-1` if telemetry is not available.

## Running Qdrant locally

```bash
docker run -p 6333:6333 qdrant/qdrant
```
