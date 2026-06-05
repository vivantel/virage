# @vivantel/virage-embedder-fastembed

[![npm version](https://img.shields.io/npm/v/@vivantel/virage-embedder-fastembed.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-fastembed)

Fast, local ONNX-based embedding provider for `@vivantel/virage-core` using [FastEmbed](https://github.com/Anush008/fastembed-js). No API key required.

## Installation

```bash
npm install @vivantel/virage-embedder-fastembed
```

> **Note**: `fastembed` downloads ONNX Runtime binaries during install. If you're in a CI environment or want to skip GPU binaries: `npm install @vivantel/virage-embedder-fastembed --ignore-scripts` — the CPU runtime works fine without the postinstall scripts.

## Usage

```typescript
import { FastEmbedEmbedder } from "@vivantel/virage-embedder-fastembed";

const embedder = new FastEmbedEmbedder({
  model: "BAAI/bge-small-en-v1.5",
  dimensions: 384,
});
```

The inner model is initialized lazily on the first `embed()` call.

## JSON config

```json
{
  "embedder": {
    "package": "@vivantel/virage-embedder-fastembed",
    "config": {
      "model": "BAAI/bge-small-en-v1.5",
      "dimensions": 384
    }
  }
}
```

## Supported models

| Model                            | Dimensions | Notes                      |
| -------------------------------- | ---------- | -------------------------- |
| `BAAI/bge-small-en-v1.5`         | 384        | Default — fast and compact |
| `BAAI/bge-base-en-v1.5`          | 768        | Better quality             |
| `BAAI/bge-large-en-v1.5`         | 1024       | Highest quality            |
| `nomic-ai/nomic-embed-text-v1.5` | 768        | Long context (8192 tokens) |

## Options

| Option                 | Type      | Description                                             |
| ---------------------- | --------- | ------------------------------------------------------- |
| `model`                | `string`  | Model name (default: `"BAAI/bge-small-en-v1.5"`)        |
| `dimensions`           | `number`  | Output dimensions (auto-detected from model if omitted) |
| `cacheDir`             | `string`  | Local model cache directory                             |
| `showDownloadProgress` | `boolean` | Show download progress bar (default: `false`)           |

## License

MIT
