# Rerankers

Reranker plugins implement `Reranker` from `@vivantel/virage-core`. They re-score a candidate set of artifacts after vector retrieval, improving result relevance.

## Quick reference

| Package | Key | Requires | Notes |
|---|---|---|---|
| `@vivantel/virage-reranker-cross-encoder` | `cross-encoder` | None | Local ONNX, no API key |
| `@vivantel/virage-reranker-llm` | `llm` | Anthropic API key | LLM re-scoring via Claude |

---

## `@vivantel/virage-reranker-cross-encoder`

Local cross-encoder re-ranker using ONNX via `@xenova/transformers`. Downloads the model on first use; no API key needed.

**JSON config:**

```json
{
  "reranker": {
    "package": "@vivantel/virage-reranker-cross-encoder",
    "config": {
      "model": "Xenova/ms-marco-MiniLM-L-6-v2",
      "topK": 5
    }
  }
}
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | `"Xenova/ms-marco-MiniLM-L-6-v2"` | HuggingFace model ID |
| `topK` | `number` | `5` | Number of results to return after re-ranking |
| `minScore` | `number` | `0` | Drop results below this sigmoid-calibrated score (0–1) |

**Performance:** Adds ~30–200ms per query depending on candidate set size and hardware. Run `preWarm()` to load the model before the first query.

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
