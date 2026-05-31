# @vivantel/rag-core

Core RAG pipeline tools - universal chunking, embedding, and vector store orchestration.

[![CI](https://github.com/vivantel/rag-core/actions/workflows/ci.yaml/badge.svg)](https://github.com/vivantel/rag-core/actions/workflows/ci.yaml)
[![Release](https://github.com/vivantel/rag-core/actions/workflows/release.yaml/badge.svg)](https://github.com/vivantel/rag-core/actions/workflows/release.yaml)
[![npm version](https://img.shields.io/npm/v/@vivantel/rag-core.svg)](https://www.npmjs.com/package/@vivantel/rag-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install @vivantel/rag-core
```

## Quick Start

### 1. Create a config file (`rag.config.ts`)

```typescript
import { defineConfig, createChunker, tokenStrategy } from '@vivantel/rag-core';
import { readFile } from 'fs/promises';

export default defineConfig({
  chunkers: [
    createChunker({
      name: 'my-chunker',
      patterns: ['docs/**/*.md'],
      async process(content, filePath, commitHash) {
        return [{
          content,
          metadata: { type: 'doc', file: filePath },
          sourceFile: filePath,
          commitHash
        }];
      }
    })
  ],
  
  embedder: new MyEmbedderProvider({ apiKey: process.env.API_KEY }),
  vectorStore: new MyVectorStore({ url: process.env.DB_URL })
});
```

### 2. Run the pipeline

```bash
rag-update --config rag.config.ts
```

## Built-in Strategies

### Chunk Strategies

- `tokenStrategy({ maxTokens, overlap })` - Split by approximate token count
- `markdownHeadersStrategy()` - Split by Markdown headers (##, ###)
- `semanticStrategy()` - Split by sentence boundaries
- `wholeFileStrategy()` - One chunk per file

## License

MIT
