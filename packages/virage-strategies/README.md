# @vivantel/virage-strategies

[![npm version](https://img.shields.io/npm/v/@vivantel/virage-strategies.svg)](https://www.npmjs.com/package/@vivantel/virage-strategies)

Built-in chunking strategies for `@vivantel/virage-core`.

## Installation

```bash
npm install @vivantel/virage-strategies
```

## Usage

```typescript
import { createChunker } from "@vivantel/virage-core";
import {
  markdownHeadersStrategy,
  tokenStrategy,
  wholeFileStrategy,
  semanticStrategy,
} from "@vivantel/virage-strategies";

const chunkers = [
  createChunker({ patterns: ["docs/**/*.md"], strategy: markdownHeadersStrategy() }),
  createChunker({ patterns: ["src/**/*.ts"], strategy: tokenStrategy({ maxTokens: 500 }) }),
  createChunker({ patterns: ["**/*.yaml"], strategy: wholeFileStrategy() }),
];
```

Or via JSON config (no TypeScript needed):

```json
{
  "chunkers": [
    { "patterns": ["docs/**/*.md"], "strategy": "markdownHeaders" },
    { "patterns": ["src/**/*.ts"], "strategy": "token", "strategyOptions": { "maxTokens": 500 } }
  ]
}
```

## Strategies

### `markdownHeadersStrategy()`

Splits Markdown files at each heading (`##`, `###`, …). Each section becomes one chunk with the header as metadata.

Best for: documentation, wikis, README files.

### `tokenStrategy(options?)`

Splits text into fixed-size token windows with optional overlap.

| Option | Default | Description |
| --- | --- | --- |
| `maxTokens` | `512` | Maximum tokens per chunk |
| `overlap` | `50` | Token overlap between consecutive chunks |

Best for: source code, structured text, anything that needs size control.

### `semanticStrategy()`

Splits on paragraph and sentence boundaries, trying to keep semantically coherent units together.

Best for: prose, articles, documentation with long paragraphs.

### `wholeFileStrategy()`

Returns the entire file as a single chunk.

Best for: small configuration files, YAML, short rule files where splitting would lose context.

## License

MIT
