---
id: ADR-034
title: Sigmoid score calibration and candidate oversampling for cross-encoder reranker
status: Accepted
date: 2026-06-20
---

## Context

Two bugs combined to make the cross-encoder reranker produce meaningless similarity scores:

1. **Min-max normalization within the returned batch.** After sorting candidates by raw logit, the scores were normalized as `(logit − min) / (max − min)`. The top result always received `1.0` (100%) regardless of absolute relevance. Queries like "bullshit sliding electricity" returned 100% because the most-similar vector in the index — however irrelevant — became the batch maximum.

2. **Reranker received exactly `topK` candidates to rerank, then returned `topK`.** Without oversampling, the reranker was just reordering an already-final list with no selection taking place.

## Decision

**Sigmoid calibration.** Replace min-max normalization with `sigmoid(logit)` in `CrossEncoderReranker`. For ms-marco cross-encoders, the raw logit approximates log-odds of relevance; applying sigmoid gives a calibrated P(relevant | query, doc) in [0, 1] that is meaningful in absolute terms.

**Candidate oversampling.** Add `rerankOversample` (default `5`) to `RAGPipelineConfig.search` and `JsonSearchConfig`. When a reranker is configured, call sites fetch `topK × rerankOversample` candidates from the vector store before passing them all to the reranker, which then returns the best `topK`.

**`minScore` threshold.** Add optional `minScore` to `CrossEncoderRerankerOptions`. Results with `sigmoid(logit) < minScore` are dropped from the output. Defaults to `0` (disabled).

## Consequences

- **+** Irrelevant queries now receive near-zero similarity scores instead of a misleading 100%.
- **+** The reranker actually selects from a meaningful candidate pool, improving MRR and precision@K.
- **+** `rerankOversample` is configurable per project in `virage.config.json` under `search.rerankOversample`.
- **+** `minScore` gives operators a clean way to filter garbage results.
- **−** With `rerankOversample=5`, the cross-encoder scores 5× more (query, chunk) pairs per search. Latency increase is proportional to `rerankOversample`.
- **−** Single-candidate results no longer get an artificial `1.0` — they receive `sigmoid(logit)`, which may be less than 1.

## Alternatives Considered

[Not documented in original]

## References

[Not documented in original]
