# @vivantel/rag-core

[![CI](https://github.com/vivantel/rag_core/actions/workflows/ci-rag-core.yaml/badge.svg)](https://github.com/vivantel/rag_core/actions/workflows/ci-rag-core.yaml)
[![npm version](https://img.shields.io/npm/v/@vivantel/rag-core.svg)](https://www.npmjs.com/package/@vivantel/rag-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Pipeline orchestrator, provider interfaces, and CLI for Git-aware RAG indexing.

## Installation

```bash
npm install @vivantel/rag-core
```

## Quick start

```bash
npx rag-update init    # generate rag.config.json interactively
npx rag-update         # run the pipeline
```

## What it does

Four pipeline stages run in sequence:

1. **GitTracker** — finds files matching your chunker patterns and detects changes via commit hashes
2. **ChunkProcessor** — splits each file into `Chunk[]` using your configured strategy
3. **EmbedderProcessor** — embeds chunks incrementally (skips unchanged content); detects model changes and auto-invalidates stale embeddings
4. **Uploader** — syncs the vector store: deletes stale documents, upserts new ones

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
  model?: string;           // used for cache invalidation
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
import { createChunker } from "@vivantel/rag-core";
import { markdownHeadersStrategy } from "@vivantel/rag-strategies";

// Strategy shorthand
createChunker({ patterns: ["docs/**/*.md"], strategy: markdownHeadersStrategy() });

// Custom process function
createChunker({
  name: "custom",
  patterns: ["**/*.txt"],
  process: async (content, filePath, commitHash) => [{ content, metadata: {}, sourceFile: filePath, commitHash }],
});
```

## Embeddings cache invalidation

`embeddings.json` stores metadata about the last embedding run. If the `model` or `dimensions` of your provider changes, the cache is automatically cleared and all chunks are re-embedded. Switching providers (e.g., from GitHub Models to OpenAI direct) but keeping the same model name does **not** invalidate the cache — the vectors are identical.

## License

MIT
