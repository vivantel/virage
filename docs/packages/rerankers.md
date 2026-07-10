# Rerankers

Rerankers re-score a candidate set of results after vector retrieval, improving relevance. The cross-encoder is built into `@vivantel/virage` via `"builtin": "cross-encoder"` — no separate package needed.

## Quick reference

| Key | Package | Requires | Notes |
|---|---|---|---|
| `cross-encoder` | built-in | None | Local ONNX, no API key |
| `llm` | `@vivantel/virage-reranker-llm` | Anthropic API key | LLM re-scoring via Claude |

---

## Built-in cross-encoder (`builtin: "cross-encoder"`)

ORT-based local cross-encoder compiled into the `virage` binary. Encodes query+passage pairs as `[CLS] query [SEP] passage [SEP]` and scores relevance with a single forward pass. Model downloads from HuggingFace Hub on first use.

Reranking is applied automatically during `virage query` when `providers.reranker` is configured — no extra flag needed.

**JSON config — HuggingFace download:**

```json
{
  "providers": {
    "reranker": {
      "builtin": "cross-encoder",
      "options": {
        "source": { "model": "Xenova/ms-marco-MiniLM-L-6-v2", "cacheDir": ".virage/model-cache" }
      }
    }
  }
}
```

**JSON config — local files:**

```json
{
  "providers": {
    "reranker": {
      "builtin": "cross-encoder",
      "options": {
        "source": { "modelPath": "/path/to/model.onnx", "tokenizerPath": "/path/to/tokenizer.json" },
        "activation": "sigmoid"
      }
    }
  }
}
```

**`source` variants (same as embedder — mutually exclusive):**

| Variant | Required fields | Optional fields |
|---|---|---|
| HuggingFace | `model` | `modelFile`, `tokenizerFile`, `cacheDir` |
| URL | `modelUrl`, `tokenizerUrl` | `cacheDir` |
| Local | `modelPath`, `tokenizerPath` | — |

**Top-level options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `source` | object | required | Model source (see variants above) |
| `maxLength` | number | `512` | Max token sequence length |
| `activation` | `"none"` \| `"sigmoid"` \| `"softmax"` | `"none"` | Score activation applied to raw logits |
| `scoreIndex` | number | `0` | Index into the logits vector to use as the relevance score |

**Choosing `activation`:** For ms-marco models (single relevance logit), `"sigmoid"` maps scores to [0, 1]. For multi-label models, `"softmax"` normalises across classes.

**Performance:** Adds ~30–200ms per query depending on candidate set size and hardware. The model is loaded once per `virage query` invocation.

---

## `@vivantel/virage-reranker-llm`

LLM-based re-ranker using the Anthropic API (Claude). Each query calls the LLM to score relevance of candidate results.

**JSON config:**

```json
{
  "reranker": {
    "package": "@vivantel/virage-reranker-llm",
    "config": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "model": "claude-haiku-4-5",
      "topK": 5
    }
  }
}
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | `$ANTHROPIC_API_KEY` | Anthropic API key |
| `model` | `string` | `"claude-haiku-4-5"` | Claude model ID |
| `topK` | `number` | `5` | Number of results to return after re-ranking |

**Cost:** Each query uses one API call with all candidate snippets in the prompt. Use `claude-haiku-4-5` (default) for low cost; upgrade to `claude-sonnet-4-6` or `claude-opus-4-8` for highest relevance.

---

## Shared interface

```typescript
interface Reranker {
  rerank(
    query: string,
    candidates: ArtifactSet[],
    topK?: number,
  ): Promise<ArtifactSet[]>;
  preWarm?(): Promise<void>;
}
```
