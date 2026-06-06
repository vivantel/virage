# @vivantel/virage-code-chunk-chunker

[![npm version](https://img.shields.io/npm/v/@vivantel/virage-code-chunk-chunker.svg)](https://www.npmjs.com/package/@vivantel/virage-code-chunk-chunker)

AST-aware code chunking strategy for `@vivantel/virage-core`, powered by [code-chunk](https://www.npmjs.com/package/code-chunk).

Splits source files at semantic boundaries (functions, classes, methods) using tree-sitter, preserving scope chain and entity context in chunk metadata. This produces more coherent embeddings than character/token-based chunking, which can cut mid-function.

**Supported languages:** TypeScript, JavaScript, Python, Rust, Go, Java

## Installation

```bash
npm install @vivantel/virage-code-chunk-chunker
```

## Usage

```typescript
import { createChunker } from "@vivantel/virage-core";
import { codeChunkStrategy } from "@vivantel/virage-code-chunk-chunker";

const chunker = createChunker({
  patterns: ["src/**/*.{ts,js,py,rs,go,java}"],
  strategy: codeChunkStrategy(),
});
```

With options:

```typescript
const chunker = createChunker({
  patterns: ["src/**/*.ts"],
  strategy: codeChunkStrategy({
    maxChunkSize: 2000,
    contextMode: "minimal",
    useContextualizedText: true, // prepend scope chain to content for richer embeddings
  }),
});
```

### Plugin discovery

The package exports a `ragPlugin` that the virage plugin system can discover automatically:

```typescript
import { discoverPlugins } from "@vivantel/virage-core";

const plugins = await discoverPlugins(["@vivantel/virage-code-chunk-chunker"]);
// [{ name: "code-chunk-ast", type: "chunker", factory: [Function] }]
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxChunkSize` | `number` | `1500` | Maximum chunk size in bytes |
| `contextMode` | `"none" \| "minimal" \| "full"` | `"full"` | How much semantic context to include |
| `siblingDetail` | `"none" \| "names" \| "signatures"` | `"signatures"` | Level of sibling entity detail in context |
| `filterImports` | `boolean` | `false` | Remove import statements from chunks |
| `overlapLines` | `number` | `0` | Lines to overlap from the previous chunk |
| `useContextualizedText` | `boolean` | `false` | Use pre-formatted contextualized text (scope + signatures prepended) as chunk content |

## Chunk metadata

Each produced chunk includes:

```ts
{
  content: string,          // raw code text (or contextualizedText if option enabled)
  sourceFile: string,       // file path
  commitHash: string,       // filled by the pipeline
  metadata: {
    strategy: "code-chunk-ast",
    chunk_index: number,    // 0-based index within this file
    source_file: string,
    total_chunks: number,   // total chunks for this file
    scope: EntityInfo[],    // scope chain (e.g. MyClass > myMethod)
    entities: ChunkEntityInfo[], // entities defined within this chunk
  }
}
```

## License

MIT
