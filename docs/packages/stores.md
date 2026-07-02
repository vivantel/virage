# Vector Stores

Vector store plugins implement `VectorStore` from `@vivantel/virage-core`.

## Quick reference

| Package | Key | Mode | Notes |
|---|---|---|---|
| `@vivantel/virage-store-lancedb` | `lancedb` | Embedded / cloud | No server needed for local |
| `@vivantel/virage-store-qdrant` | `qdrant` | Local or cloud | REST/gRPC |
| `@vivantel/virage-store-postgres` | `postgres` | Server | Requires pgvector extension |
| `@vivantel/virage-store-chromadb` | `chromadb` | Local or hosted | HTTP API |

---

## `@vivantel/virage-store-lancedb`

LanceDB embedded vector store. Data lives in a local directory; no server process required. Supports LanceDB Cloud for hosted deployment.

**JSON config:**

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

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `uri` | `string` | required | Path to local dir or `db://` cloud URI |
| `apiKey` | `string` | — | LanceDB Cloud API key |
| `table` | `string` | `"documents"` | Table name |
| `dimensions` | `number` | `1536` | Vector dimensions |

**FTS:** LanceDB full-text search index is created automatically. Requires `tantivy` feature (included in bundled LanceDB WASM).

---

## `@vivantel/virage-store-qdrant`

Qdrant vector database — local Docker or Qdrant Cloud.

**JSON config:**

```json
{
  "vectorStore": {
    "package": "@vivantel/virage-store-qdrant",
    "config": {
      "url": "http://localhost:6333",
      "collection": "virage",
      "dimensions": 1536
    }
  }
}
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | `"http://localhost:6333"` | Qdrant server URL |
| `apiKey` | `string` | — | Qdrant Cloud API key |
| `collection` | `string` | `"virage"` | Collection name |
| `dimensions` | `number` | `1536` | Vector dimensions |
| `distance` | `string` | `"Cosine"` | Distance metric (`Cosine`, `Dot`, `Euclid`) |

---

## `@vivantel/virage-store-postgres`

PostgreSQL + pgvector. Requires the `pgvector` extension installed in Postgres.

**JSON config:**

```json
{
  "vectorStore": {
    "package": "@vivantel/virage-store-postgres",
    "config": {
      "connectionString": "${DATABASE_URL}",
      "dimensions": 1536
    }
  }
}
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `connectionString` | `string` | required | `postgresql://user:pass@host/db` |
| `table` | `string` | `"documents"` | Table name |
| `dimensions` | `number` | `1536` | Vector dimensions |
| `ssl` | `boolean` | `false` | Enable SSL |
| `indexType` | `"ivfflat"` \| `"hnsw"` | `"ivfflat"` | pgvector index algorithm |
| `indexParams` | `object` | — | Algorithm-specific params (see below) |

**Index params — IVFFlat:**

```json
{ "lists": 100 }
```

**Index params — HNSW:**

```json
{ "m": 16, "efConstruction": 64 }
```

**Setup:** The table and extension are created automatically on first `upsert()` call. Grant `CREATE EXTENSION` privilege or create `pgvector` manually:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## `@vivantel/virage-store-chromadb`

ChromaDB via the JavaScript HTTP client. Supports local (Docker) and hosted ChromaDB.

**JSON config:**

```json
{
  "vectorStore": {
    "package": "@vivantel/virage-store-chromadb",
    "config": {
      "url": "http://localhost:8000",
      "collection": "virage",
      "dimensions": 1536
    }
  }
}
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | `"http://localhost:8000"` | ChromaDB server URL |
| `apiKey` | `string` | — | Auth token for hosted ChromaDB |
| `collection` | `string` | `"virage"` | Collection name |
| `dimensions` | `number` | `1536` | Vector dimensions |

---

## Shared interface

```typescript
interface VectorStore {
  readonly name: string;
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  query(vector: number[], opts: QueryOptions): Promise<ArtifactSet[]>;
  delete(ids: string[]): Promise<void>;
  existingHashes?(hashes: string[]): Promise<string[]>;
}
```

`existingHashes` is used by the orchestrator to skip re-embedding chunks that are already in the store (embedding cache).
