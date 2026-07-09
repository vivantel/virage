# Embedders

Embedder plugins implement `EmbeddingProvider`. They convert text into float vectors stored in the vector store. ONNX inference is built into `@vivantel/virage` via `"builtin": "onnx"` in config — no separate package needed.

## Quick reference

| Package | Key | Requires | Model source |
|---|---|---|---|
| `@vivantel/virage-embedder-openai` | `openai` | API key | OpenAI / compatible endpoint |
| `@vivantel/virage-embedder-fastembed` | `fastembed` | None | Bundled ONNX (fastembed) |
| `@vivantel/virage-embedder-transformers` | `transformers` | None | HuggingFace Hub (auto-download) |

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
