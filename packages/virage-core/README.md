# @vivantel/virage-core

[![CI](https://github.com/vivantel/virage/actions/workflows/ci-rag-core.yaml/badge.svg)](https://github.com/vivantel/virage/actions/workflows/ci-rag-core.yaml)
[![npm version](https://img.shields.io/npm/v/@vivantel/virage-core.svg)](https://www.npmjs.com/package/@vivantel/virage-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Pipeline orchestrator, provider interfaces, and CLI for Git-aware RAG indexing.

## Installation

```bash
npm install @vivantel/virage-core
```

## Quick start

```bash
npx virage init    # generate virage.config.json interactively
npx virage         # run the pipeline
```

## What it does

Four pipeline stages run in sequence:

1. **GitTracker** — finds files matching your chunker patterns, applies `exclude` glob filters, and detects changes via commit hashes
2. **ChunkProcessor** — splits each file into `Chunk[]` using your configured chunker plugin (runs files in parallel, concurrency = CPU core count by default)
3. **EmbedderProcessor** — embeds `chunk.denseText` into `chunk.denseVector` (skips unchanged content via `denseTextHash`); detects model changes and auto-invalidates stale embeddings
4. **Uploader** — syncs the vector store: deletes stale documents, upserts new ones

## Four-artifact chunk model

Every chunk produced by a `FileChunker` plugin carries four text artifacts:

| Field | Purpose |
| ----- | ------- |
| `denseText` | Breadcrumb prefix + full body — sent to the embedding model |
| `denseVector` | Embedding of `denseText` — stored in vector index for ANN search |
| `sparseText` | Raw body without breadcrumb — used for BM25 / FTS lexical search |
| `contextText` | Full body + boundary padding from neighbouring windows — passed to LLM |
| `denseTextHash` | `sha256(denseText).slice(0,16)` — 16-char hex primary cache key |

```typescript
interface Chunk {
  denseText: string;
  sparseText: string;
  contextText: string;
  denseTextHash: string;
  metadata: ChunkMeta;
  sourceFile: string;
  commitHash: string;
}
```

## Config format

Configuration lives in `virage.config.json`. The `chunking` section groups chunker definitions and global file exclusions:

```json
{
  "chunking": {
    "exclude": ["**/vendor/**", "**/*.min.js", "**/dist/**"],
    "chunkers": [
      {
        "patterns": ["**/*.md"],
        "plugin": "@vivantel/virage-chunker-ce-md",
        "strategyOptions": { "maxTokens": 512, "overlap": 0.15 }
      },
      {
        "patterns": ["src/**/*.ts", "src/**/*.tsx"],
        "plugin": "@vivantel/virage-code-chunk-chunker",
        "strategyOptions": { "maxTokens": 512 }
      }
    ]
  }
}
```

`chunking.exclude` accepts glob patterns (using `minimatch` semantics). Files matching any pattern are skipped at both the scanning and chunking stages. `virage init` seeds this list with ecosystem-specific defaults for Node.js, .NET, Java, Go, and C/C++.

## Provider interfaces

Implement these three interfaces to integrate any backend:

### `FileChunker`

```typescript
interface FileChunker {
  name: string;
  version: string;        // semver — used to build sparseTextId and contextTextHash
  patterns: string[];
  sparseTextId: string;   // stable fingerprint for session-level sparse cache
  contextTextHash: string; // stable fingerprint for session-level context cache
  chunk(filePath: string, commitHash: string): Promise<Chunk[]>;
  canProcess?(filePath: string): Promise<boolean>;
}
```

All chunker plugins are external npm packages. Built-in strategies have been removed. Use `@vivantel/virage-code-chunk-chunker` for source code or one of the CE/EE chunker packages for documents.

### `EmbeddingProvider`

```typescript
interface EmbeddingProvider {
  name: string;
  dimensions: number;
  model?: string; // used for cache invalidation
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
}
```

### `VectorStore`

```typescript
interface VectorStore {
  name: string;
  initialize(): Promise<void>;
  upsert(docs: VectorDocument[]): Promise<void>;
  deleteBySourceFile(files: string[]): Promise<void>;
  getCurrentState(): Promise<Map<string, string>>;
  search(embedding: number[], topK: number): Promise<VectorSearchResult[]>;
}
```

## Chunk utility helpers

```typescript
import { makeDenseText, makeSparseText, computeDenseTextHash } from "@vivantel/virage-core";

// Build the denseText string
const denseText = makeDenseText(["Chapter 1", "Section 2"], "This is the body.");
// → "Chapter 1 › Section 2. This is the body."

// Compute the 16-char hex cache key
const hash = computeDenseTextHash(denseText);
// → "a3f7c2e1b4d90581"
```

## Caching behaviour

- **Per-chunk cache**: embedder checks `denseTextHash` before calling the embedding model. If the hash is already in the SQLite `chunks` table, the existing `denseVector` is reused.
- **Session-level cache**: `sparseTextId` and `contextTextHash` are stored in the `meta` table. If unchanged between runs, the FTS rebuild and context refresh are skipped respectively.
- **Schema migration**: if the `chunks` table has a `content` column (old schema), the table is dropped and a warning is logged. Re-index after upgrading.

## License

MIT
