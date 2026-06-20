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
2. **ChunkProcessor** — splits each file into `Chunk[]` using your configured strategy (runs files in parallel, concurrency = CPU core count by default)
3. **EmbedderProcessor** — embeds chunks incrementally (skips unchanged content); detects model changes and auto-invalidates stale embeddings
4. **Uploader** — syncs the vector store: deletes stale documents, upserts new ones

## Config format

Configuration lives in `virage.config.json`. The `chunking` section groups chunker definitions and global file exclusions:

```json
{
  "chunking": {
    "exclude": ["**/vendor/**", "**/*.min.js", "**/dist/**"],
    "chunkers": [
      { "patterns": ["**/*.md"], "strategy": "markdownHeaders" },
      { "patterns": ["src/**/*.ts"], "strategy": "codeChunkAst" }
    ]
  }
}
```

`chunking.exclude` accepts glob patterns (using `minimatch` semantics). Files matching any pattern are skipped at both the scanning and chunking stages. `virage init` seeds this list with ecosystem-specific defaults for Node.js, .NET, Java, Go, and C/C++.

**Backward compatibility:** configs with a root-level `chunkers` array (pre-0.2.37) are automatically promoted to `chunking.chunkers` at load time — no manual migration needed.

## Provider interfaces

Implement these three interfaces to integrate any backend:

```typescript
interface FileChunker {
  name: string;
  patterns: string[];
  chunk(filePath: string, commitHash: string): Promise<Chunk[]>;
}

interface EmbeddingProvider {
  name: string;
  dimensions: number;
  model?: string; // used for cache invalidation
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
}

interface VectorStore {
  name: string;
  initialize(): Promise<void>;
  upsert(docs: VectorDocument[]): Promise<void>;
  deleteBySourceFile(files: string[]): Promise<void>;
  getCurrentState(): Promise<Map<string, string>>;
  search(embedding: number[], topK: number): Promise<VectorSearchResult[]>;
}
```

## createChunker helper

```typescript
import { createChunker } from "@vivantel/virage-core";
import { markdownHeadersStrategy } from "@vivantel/virage-strategies";

// Strategy shorthand
createChunker({
  patterns: ["docs/**/*.md"],
  strategy: markdownHeadersStrategy(),
});

// Custom process function
createChunker({
  name: "custom",
  patterns: ["**/*.txt"],
  process: async (content, filePath, commitHash) => [
    { content, metadata: {}, sourceFile: filePath, commitHash },
  ],
});
```

## Embeddings cache invalidation

`embeddings.json` stores metadata about the last embedding run. If the `model` or `dimensions` of your provider changes, the cache is automatically cleared and all chunks are re-embedded. Switching providers (e.g., from GitHub Models to OpenAI direct) but keeping the same model name does **not** invalidate the cache — the vectors are identical.

## License

MIT
