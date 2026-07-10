# Embedders

Embedder plugins convert text into float vectors stored in the vector store. ONNX inference is built into `@vivantel/virage` via `"builtin": "onnx"` — no separate package needed.

## Quick reference

| Key | Package | Requires | Model source |
|---|---|---|---|
| `onnx` | built-in | None | HuggingFace Hub, local files |
| `openai` | `@vivantel/virage-embedder-openai` | API key | OpenAI / compatible endpoint |
| `fastembed` | `@vivantel/virage-embedder-fastembed` | None | HuggingFace Hub (fastembed) |
| `transformers` | `@vivantel/virage-embedder-transformers` | None | HuggingFace Hub (auto-download) |

---

## Built-in ONNX embedder (`builtin: "onnx"`)

ORT-based local embedder compiled into the `virage` binary. Model downloads from HuggingFace Hub on first use; subsequent runs use the cached files.

**JSON config — HuggingFace download:**

```json
{
  "providers": {
    "embedder": {
      "builtin": "onnx",
      "options": {
        "source": { "model": "Xenova/all-MiniLM-L6-v2", "cacheDir": ".virage/model-cache" },
        "dimensions": 384
      }
    }
  }
}
```

**JSON config — local files:**

```json
{
  "providers": {
    "embedder": {
      "builtin": "onnx",
      "options": {
        "source": { "modelPath": "/path/to/model.onnx", "tokenizerPath": "/path/to/tokenizer.json" },
        "dimensions": 768
      }
    }
  }
}
```

**`source` variants (mutually exclusive — only one set of fields per `source` object):**

| Variant | Required fields | Optional fields |
|---|---|---|
| HuggingFace | `model` | `modelFile`, `tokenizerFile`, `cacheDir` |
| URL | `modelUrl`, `tokenizerUrl` | `cacheDir` |
| Local | `modelPath`, `tokenizerPath` | — |

**Top-level options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `source` | object | required | Model source (see variants above) |
| `dimensions` | number | `384` | Output vector dimensions |
| `maxLength` | number | `512` | Max token sequence length |
| `pooling` | `"mean"` \| `"cls"` | `"mean"` | Pooling strategy |
| `normalize` | boolean | `true` | L2-normalize output vectors |

**`source.model` (HuggingFace)** — tries `onnx/model_quantized.onnx` first, then `onnx/model.onnx`. Override with `modelFile` to select a specific file.

---

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
