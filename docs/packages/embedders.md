# Embedders

Embedder plugins implement `EmbeddingProvider` from `@vivantel/virage-core`. They convert text into float vectors stored in the vector store.

## Quick reference

| Package | Key | Requires | Model source |
|---|---|---|---|
| `@vivantel/virage-embedder-openai` | `openai` | API key | OpenAI / compatible endpoint |
| `@vivantel/virage-embedder-fastembed` | `fastembed` | None | Bundled ONNX (fastembed) |
| `@vivantel/virage-embedder-transformers` | `transformers` | None | HuggingFace Hub (auto-download) |
| `@vivantel/virage-embedder-onnx` | `onnx` | None | Local dir or HuggingFace Hub |

---

## `@vivantel/virage-embedder-openai`

OpenAI-compatible embedding provider. Works with OpenAI, Azure OpenAI, Ollama, LM Studio, GitHub Models.

**JSON config:**

```json
{
  "embedder": {
    "package": "@vivantel/virage-embedder-openai",
    "config": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "text-embedding-3-small",
      "dimensions": 1536
    }
  }
}
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | required | API key |
| `model` | `string` | required | Model ID |
| `dimensions` | `number` | `1536` | Output vector dimensions |
| `baseURL` | `string` | OpenAI default | Custom endpoint (Ollama, Azure, etc.) |
| `organizationId` | `string` | — | OpenAI org ID |
| `maxRetries` | `number` | `3` | Retry attempts on transient errors |

**Presets:** `createOllamaEmbedder()`, `createAzureOpenAIEmbedder()` from the same package.

---

## `@vivantel/virage-embedder-fastembed`

Local ONNX-based embedder using the fastembed library. No API key; model downloads on first use.

**JSON config:**

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

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | required | HuggingFace model ID |
| `dimensions` | `number` | required | Vector dimensions |
| `cacheDir` | `string` | `~/.cache/fastembed` | Model download location |

---

## `@vivantel/virage-embedder-transformers`

Local embedder via `@xenova/transformers` (Transformers.js). Downloads and caches model on first `preWarm()` call.

**JSON config:**

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

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | required | HuggingFace model ID |
| `dimensions` | `number` | required | Vector dimensions |
| `quantized` | `boolean` | `true` | Use quantized (int8) ONNX model |
| `cacheDir` | `string` | `.cache/transformers` | Model download location |

---

## `@vivantel/virage-embedder-onnx`

Runs any ONNX sentence transformer locally. Supports local model directory or auto-download from HuggingFace.

**JSON config:**

```json
{
  "embedder": {
    "package": "@vivantel/virage-embedder-onnx",
    "config": {
      "model": "/path/to/model",
      "dimensions": 768
    }
  }
}
```

Or with a HuggingFace model ID (downloaded on first use):

```json
{
  "embedder": {
    "package": "@vivantel/virage-embedder-onnx",
    "config": {
      "model": "BAAI/bge-base-en-v1.5",
      "dimensions": 768
    }
  }
}
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | required | Local dir or HuggingFace model ID |
| `dimensions` | `number` | required | Vector dimensions |
| `tokenizerPath` | `string` | `{model}/tokenizer.json` | Override tokenizer location |
| `executionProvider` | `"cpu"` \| `"cuda"` \| `"tensorrt"` \| `"directml"` \| `"rocm"` | `"cpu"` | ONNX execution provider |
| `deviceId` | `number` | — | Device index for multi-GPU |
| `numThreads` | `number` | — | Intra-op thread count |
| `graphOptimizationLevel` | `0`–`3` | `3` (all) | ONNX graph optimization level |
| `pooling` | `"mean"` \| `"cls"` | `"mean"` | Token pooling strategy |
| `normalize` | `boolean` | `true` | L2-normalize output vector |
| `maxSequenceLength` | `number` | `512` | Max tokens per input |
| `cacheDir` | `string` | `~/.virage/models` | HuggingFace download cache |

**Environment:** `VIRAGE_MODELS_DIR` overrides the default `cacheDir`.

**preWarm:** Load the ONNX session and tokenizer eagerly (before first `embed()` call):

```typescript
const embedder = new OnnxEmbedder({ model: "/local/bge", dimensions: 768 });
await embedder.preWarm();
```

---

## Shared interface

All embedders implement:

```typescript
interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  preWarm?(): Promise<void>;
  setLogger?(logger: Logger): void;
}
```
