# @vivantel/rag-core

Core RAG pipeline tools - universal chunking, embedding, and vector store orchestration.

[![CI](https://github.com/vivantel/rag_core/actions/workflows/ci.yaml/badge.svg)](https://github.com/vivantel/rag_core/actions/workflows/ci.yaml)
[![Release](https://github.com/vivantel/rag_core/actions/workflows/release.yaml/badge.svg)](https://github.com/vivantel/rag_core/actions/workflows/release.yaml)
[![npm version](https://img.shields.io/npm/v/@vivantel/rag-core.svg)](https://www.npmjs.com/package/@vivantel/rag-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install @vivantel/rag-core
```

## Quick Start

### 1. Generate a config (recommended)

```bash
rag-update init
```

Scans your project for known file types and generates a `rag.config.ts` with the right strategy per pattern. You then fill in your embedding provider and vector store.

### 2. Or write a config manually (`rag.config.ts`)

```typescript
import type { RAGPipelineConfig } from "@vivantel/rag-core";
import {
  createChunker,
  markdownHeadersStrategy,
  tokenStrategy,
  wholeFileStrategy,
} from "@vivantel/rag-core";

const config: RAGPipelineConfig = {
  chunkers: [
    // Different directories can use different strategies
    createChunker({
      patterns: ["docs/**/*.md"],
      strategy: markdownHeadersStrategy(),
    }),
    createChunker({
      patterns: ["rules/**/*.md"],
      strategy: wholeFileStrategy(),
    }),
    createChunker({
      patterns: ["src/**/*.ts", "src/**/*.tsx"],
      strategy: tokenStrategy(),
    }),
  ],
  embedder: new MyEmbedderProvider({ apiKey: process.env.API_KEY }),
  vectorStore: new MyVectorStore({ url: process.env.DB_URL }),
};

export default config;
```

For custom chunking logic, use the `process` callback instead of `strategy`:

```typescript
createChunker({
  name: "custom",
  patterns: ["**/*.txt"],
  process: async (content, filePath, commitHash) => [
    {
      content,
      metadata: { file: filePath },
      sourceFile: filePath,
      commitHash,
    },
  ],
});
```

### 3. Run the pipeline

```bash
rag-update --config rag.config.ts
```

## Built-in Strategies

| Factory                                   | Best for                        |
| ----------------------------------------- | ------------------------------- |
| `tokenStrategy({ maxTokens?, overlap? })` | Source code, structured text    |
| `markdownHeadersStrategy()`               | Markdown documentation          |
| `semanticStrategy()`                      | Prose, articles                 |
| `wholeFileStrategy()`                     | Small configs, rule files, YAML |

## License

MIT
