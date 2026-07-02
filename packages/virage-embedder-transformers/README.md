# @vivantel/virage-embedder-transformers

[![npm version](https://img.shields.io/npm/v/@vivantel/virage-embedder-transformers.svg)](https://www.npmjs.com/package/@vivantel/virage-embedder-transformers)

Local, offline embedding provider for `@vivantel/virage-core` using `@huggingface/transformers`. No API key required — models run entirely on your machine.

→ [Monorepo docs: docs/packages/embedders.md](../../docs/packages/embedders.md)

## Installation

```bash
npm install @vivantel/virage-embedder-transformers
```

## Usage

```typescript
import { TransformersEmbedder } from "@vivantel/virage-embedder-transformers";

const embedder = new TransformersEmbedder({
  model: "Xenova/all-MiniLM-L6-v2",
  dimensions: 384,
});
```

The pipeline initializes lazily — the model is downloaded on the first `embed()` call and cached locally.

## JSON config

```json
{
  "embedder": {
    "package": "@vivantel/virage-embedder-transformers",
    "config": {
      "model": "Xenova/all-MiniLM-L6-v2",
      "dimensions": 384
    }
  }
}
```

## Recommended models

| Model                                          | Dimensions | Notes                     |
| ---------------------------------------------- | ---------- | ------------------------- |
| `Xenova/all-MiniLM-L6-v2`                      | 384        | Fast, good quality, 80 MB |
| `Xenova/all-mpnet-base-v2`                     | 768        | Higher quality, 420 MB    |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 384        | Multilingual              |

Any ONNX-compatible model on the HuggingFace hub can be used.

## Options

| Option       | Type                           | Description                                                                                   |
| ------------ | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `model`      | `string`                       | HuggingFace model ID (required)                                                               |
| `dimensions` | `number`                       | Output dimensions (default: 384)                                                              |
| `device`     | `"cpu" \| "webgpu" \| "cuda"` | Inference device (default: `"cpu"`). `"cuda"` requires `onnxruntime-node` with a GPU build.  |
| `cacheDir`   | `string`                       | Local model cache directory (default: `~/.virage/models`, override with `VIRAGE_GLOBAL_DIR`) |

## First run

On the first `embed()` call the model weights are downloaded from HuggingFace and cached locally (~80–420 MB depending on the model). Subsequent runs use the cached model.

## License

MIT
