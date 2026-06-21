# Virage Roadmap

> Last updated: 2026-06-17. This document reflects the full ecosystem — `virage-core`, CLI, MCP, dashboard, chunkers, embedders, stores, agent plugins.

---

## Current capabilities

**Strengths**

| Capability | Why it matters |
|---|---|
| **Git-aware incremental indexing** | Commit-hash change detection means only modified files flow through the pipeline. For a 5,000-file TS repo, a one-file edit costs one embedding call instead of thousands. This is the single biggest cost-saver in the category. |
| **Dual-layer change detection** | File-level git hash + chunk-level SHA-256 content hash. A changed file that produces unchanged chunks (e.g. only a comment moved) skips re-embedding entirely. |
| **AST-aware code chunking** | Splitting at function/class boundaries with scope-chain metadata produces dramatically more coherent embeddings than character or token splitting. A chunk that begins mid-function is almost always noise. |
| **Pluggable-everything architecture** | Clean `FileChunker`, `EmbeddingProvider`, `VectorStore` interfaces. Swap embedders or stores without touching the pipeline. This is the right abstraction. |
| **Local-first option** | LanceDB (file-based) + FastEmbed/Transformers (no API key) = zero infrastructure, zero ongoing cost, suitable for private codebases. |
| **MCP integration** | Exposing the knowledge base via Model Context Protocol is the correct integration point for AI tools. Read-only by design. |
| **Evaluation infrastructure** | `virage eval run` / `virage eval-suite run`, experiment tracking with bootstrap significance testing, RAGAS metrics, declarative multi-config eval suites with HTTPS DB archives — this is more mature than most comparable tools. |
| **Skills system** | Summary-then-full loading pattern keeps token overhead under 150 tokens until the agent commits to a skill. |

**Current gaps**

| Gap | Impact | Why it's not just a nice-to-have |
|---|---|---|
| **No cross-file graph** | High (for code RAG) | The code chunker knows scope within a file, but doesn't know that `OrderService.ts` calls `PaymentService.ts`. A query about "how is payment processed" needs cross-file context to return the right chunks. |
| **No semantic deduplication** | Medium | If you have similar docs copied across packages, you waste embedding budget and dilute retrieval — both copies compete for the same slot. |
| **No cost estimation** | Medium | Users running against OpenAI's embedding API have no upfront signal about how much a full re-index will cost. Surprises here erode trust. |
| **No freshness weighting** | Low–Medium | All chunks are equal regardless of whether the file was touched yesterday or two years ago. For actively developed codebases, recently changed code is often more relevant to a query about current behavior. |

---

## Near-term (next 2–4 weeks)

### ~~1. Hybrid search — BM25 + vector fusion~~ ✓ Shipped

**The single highest-impact retrieval improvement available without changing embedders.**

How it works: index each chunk's text in a BM25 index (per-store adapter) in addition to the vector store. At query time, compute vector similarity scores and BM25 scores independently, then merge via Reciprocal Rank Fusion (RRF). Return the fused top-K.

```json
{
  "vectorStore": { "package": "@vivantel/virage-store-lancedb" },
  "search": {
    "hybrid": true,
    "hybridAlpha": 0.6
  }
}
```

`hybridAlpha` controls the blend: 0 = pure BM25, 1 = pure vector, 0.6 is a typical starting point. Expose as `options.search.hybridAlpha` with a default of `0.6`.

**Implementation notes:**
- LanceDB: native FTS index on the `content` column.
- PostgreSQL: `tsvector` generated column + GIN index + `plainto_tsquery`.
- Qdrant: payload text match filter via `client.scroll()` + in-process RRF.
- ChromaDB: in-memory MiniSearch side-index, invalidated after any write.

**Evaluation target:** add `hybrid_search` experiment group to `virage evaluate`. Expected MRR improvement of 10–25% on mixed exact/semantic query sets.

---

### 2. Cross-file import graph indexing

**For code RAG, file-level chunking without relationship context is incomplete.**

The code chunker already extracts scope chains within a file. The next step is to parse `import` / `require` / `use` / `from` statements and build a lightweight directed graph: `file A → [file B, file C]`.

Store this graph in `.virage/virage.db` (new `file_graph` table). At query time, optionally expand retrieved chunks with their first-degree callers/callees.

```bash
virage query "how is payment processed" --expand-graph
```

MCP tool addition: `mcp__virage__related_files` — given a file path or chunk id, returns files that import it or are imported by it.

**Scope:** import graph only (no runtime call graph — that requires instrumentation). TypeScript/JavaScript first (use existing tree-sitter from `virage-code-chunk-chunker`). Python, Go in a follow-up.

**Why this matters:** the most common complaint in code RAG is "it found the interface but not the implementation." Cross-file edges solve this.

---

### 3. Cost estimator

**Remove the guessing about how much a full re-index will cost.**

```bash
virage estimate
# → Chunks: 3,847 | New/changed: 412 | Model: text-embedding-3-small
#   Estimated tokens: ~206,000 | Estimated cost: $0.004 | Time: ~45s
```

```bash
virage estimate --force
# → Full re-embed: 3,847 chunks | Estimated tokens: ~1.9M | Cost: $0.038 | Time: ~7min
```

Implementation: dry-run the git tracker and chunk processor (no embedding calls), count chunks needing embedding, multiply by average chunk token count (tracked per model in `virage.db`), multiply by per-token price from a bundled price table (user can override).

Add `--format json` for CI integration (fail the build if estimated cost exceeds a threshold).

---

## Medium-term (4–10 weeks)

### ~~4. Re-ranking layer~~ ✓ Shipped

The pipeline fetches `topK × rerankOversample` candidates (default: 5×) from the vector store, then a re-ranker scores each (query, chunk) pair with a cross-encoder and returns the final top-K. Scores are calibrated via sigmoid so they represent P(relevant | query, chunk) in absolute terms — irrelevant queries return near-zero scores rather than inflated 100% values.

**Mode A — lightweight cross-encoder (local)**

```json
{
  "search": {
    "rerankOversample": 5,
    "reranker": {
      "package": "@vivantel/virage-reranker-cross-encoder",
      "config": { "model": "Xenova/ms-marco-MiniLM-L-6-v2", "topK": 5, "minScore": 0.1 }
    }
  }
}
```

Ships as `@vivantel/virage-reranker-cross-encoder`. ONNX model, runs locally, no API key. Adds ~50–150ms latency. `minScore` (0–1) filters out results below the sigmoid-calibrated relevance threshold.

**Mode B — LLM judge (cloud)**

```json
{
  "search": {
    "rerankOversample": 5,
    "reranker": {
      "package": "@vivantel/virage-reranker-llm",
      "config": { "model": "claude-haiku-4-5", "topK": 5 }
    }
  }
}
```

Ships as `@vivantel/virage-reranker-llm`. More expensive but higher quality for complex queries. Appropriate for low-query-volume, high-stakes contexts.

**CLI flag:** `virage query --rerank` to try re-ranking against the current index without config changes.

---

### 5. Semantic deduplication pre-pass

Before embedding a new batch of chunks, detect near-duplicates and skip one copy.

```bash
virage index --dedup-threshold 0.92
```

Algorithm: embed a random sample of existing chunks; for each new chunk, compute cosine similarity against the sample; if any existing chunk scores above the threshold, mark as duplicate and skip upload (log the pair).

Report duplicates in `virage chunks report` output:

```
Duplicate pairs detected: 14
  docs/api.md#42 ≈ packages/core/README.md#7  (sim=0.96)
  ...
```

This reduces index bloat in multi-package monorepos where the same explanatory text exists in multiple READMEs.

---

### 6. PR diff mode

Index only the files changed in a pull request — useful for CI review workflows where you want an AI agent to have fresh context on exactly what changed.

```bash
virage index --pr 247                          # GitHub PR (requires GITHUB_TOKEN)
virage index --diff main                       # local diff against a branch
virage index --diff origin/main --namespace pr-247  # isolated namespace
```

Stores PR chunks in a separate namespace in the vector store so they don't pollute the main index. The MCP server gains a `namespace` parameter on `search`.

Agent use case:
```
/rag --namespace pr-247 "what does this PR change about error handling"
```

---

### ~~7. Query analytics in the dashboard~~ ✓ Shipped

The dashboard shows both index structure and retrieval behavior.

**Search Activity panel**

| Metric | How tracked |
|---|---|
| Queries per hour | Logged to `virage.db` on each MCP and dashboard search call |
| Top 20 most-searched terms | Grouped and counted from logged queries |
| Avg similarity score of top result | Per-query, from search results |
| Zero-result queries | Queries where top score < 0.5 threshold |

The zero-result queries view is particularly actionable: repeated searches with poor results are a signal to add more content, adjust chunking strategy, or switch embedder models for that file type.

---

### 8. GitHub Actions integration

An official `vivantel/virage-action` composite action for auto-indexing on push:

```yaml
# .github/workflows/virage-index.yaml
on:
  push:
    branches: [main]

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: vivantel/virage-action@v1
        with:
          config: virage.config.json
          store-credentials: ${{ secrets.QDRANT_API_KEY }}
```

The action handles: install, cache the LanceDB/embeddings between runs (actions/cache), run `virage index`, and optionally post a summary comment on the triggering PR with stats (chunks changed, cost).

This replaces the current manual `virage install-hooks` git-hooks approach for teams that want CI-driven indexing rather than local hooks.

---

## Longer-term (10+ weeks)

### 9. Multi-project federation

Index multiple repositories under a shared namespace and query across them:

```json
{
  "federation": {
    "projects": [
      { "name": "api", "path": "../api-service", "config": "virage.config.json" },
      { "name": "frontend", "path": "../web-app", "config": "virage.config.json" }
    ]
  }
}
```

```bash
virage query "how does the frontend call the auth endpoint" --federated
```

Requires: namespace support in vector stores (already planned for PR mode), a federated query planner that fans out to each namespace and merges results.

The MCP server gains `list_namespaces` and a `namespace` parameter on `search`.

**Primary use case:** monorepos with independent sub-projects, or organizations maintaining multiple repos that an AI agent needs to reason across simultaneously.

---

### 10. OpenTelemetry export

Pipeline runs, embedding latency, search latency, and error rates are already tracked internally. Export them as standard OTEL spans and metrics:

```json
{
  "telemetry": {
    "otel": {
      "endpoint": "http://localhost:4317",
      "protocol": "grpc"
    }
  }
}
```

This lets teams plug Virage into existing Grafana/Datadog/Honeycomb setups without building custom dashboards.

The existing `virage report` and internal dashboard remain for teams without OTEL infrastructure.

---

### 11. Chunk feedback loop — closed-loop quality improvement

Allow agents and users to signal which retrieved chunks were useful:

**MCP tool:** `mcp__virage__feedback`

```json
{ "chunkId": "abc123", "query": "how is payment processed", "useful": true }
```

Store feedback in `virage.db`. Use it to:
1. **Boost useful chunks** in search via a learned score modifier (simple: multiply similarity by `1 + 0.1 * positive_count`)
2. **Surface low-quality chunks** in `virage chunks report` — chunks that are frequently retrieved but never marked useful are candidates for re-chunking
3. **Drive eval dataset generation** — `virage eval-generate --from-feedback` creates ground truth pairs from confirmed useful results

This closes the loop: the index improves from actual use rather than only from offline eval runs.

---

### 12. HyDE — Hypothetical Document Embeddings

For queries where the exact answer text would look very different from the question text, embed a hypothetical answer instead of the raw query:

```
User query: "what does parseConfig return when the file is missing?"
Hypothetical answer: "parseConfig throws a ConfigNotFoundError with the file path..."
```

The hypothetical answer's embedding is much closer to the actual implementation chunk than the question's embedding.

```json
{
  "search": {
    "hyde": {
      "enabled": true,
      "model": "claude-haiku-4-5"
    }
  }
}
```

Tradeoff: adds one LLM call per search query. Should be opt-in, benchmarkable via `virage experiment`.

---

## What we are not building (and why)

| Proposal | Reason not to build |
|---|---|
| **Real-time streaming search** | Search latency is dominated by ANN lookup (1–5ms for small indices). Streaming doesn't improve the experience meaningfully until indices exceed ~10M vectors — not the current target scale. |
| **Pinecone store** | Pinecone's proprietary inference pipeline conflicts with Virage's embedding-at-your-own-store model. Users who want managed vector search should use Qdrant Cloud. |
| **Built-in LLM generation** | Virage is a retrieval layer, not a generation layer. Adding generation couples it to specific LLM providers and makes it a worse retriever. The MCP integration is the right boundary. |
| **GUI config editor** | The `$schema` in `virage.config.json` gives IDE autocomplete. A GUI would duplicate that effort with worse coverage and add a maintenance burden. |
| **Automatic chunking strategy selection per file** | The `virage init` wizard already selects strategies based on detected file types. Fully automatic per-file switching would be unreliable and obscure what's actually happening. |

---

## Evaluation targets

Every significant retrieval change should be validated against the existing eval suite before shipping. Baselines as of v1.1.x:

| Metric | Target | Notes |
|---|---|---|
| MRR@10 | ≥ 0.72 (currently ~0.48*) | *15-query golden dataset, vector-only; run `virage eval-suite run` for reproducible measurement |
| Precision@5 | ≥ 0.70 | |
| Hit rate@5 | ≥ 0.85 | |
| Search latency p95 | ≤ 50ms | Without re-ranking; ≤ 250ms with cross-encoder |
| Index throughput | ≥ 50 chunks/s (local FastEmbed) | |
| Cost per 1K chunks (OpenAI small) | ≤ $0.002 | Incremental, not full re-embed |
