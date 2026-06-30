# ADR-040: Quality System — CLI Consolidation and 26-Metric Self-Assessment

**Status:** Accepted

## Context

The Virage evaluation and benchmarking tooling was scattered across three top-level CLI groups:

- `virage eval` — JSON dataset-based retrieval evaluation + experiment tracking
- `virage eval-suite` — multi-config suite runner with downloadable DB archives
- `virage benchmark` — embedder/chunker/reranker latency benchmarks

These were independently registered commands with inconsistent naming, separate help pages, and no way to get a single composite quality score for the whole pipeline. There was also no intrinsic self-assessment — running evaluation required a pre-built eval dataset, making quality assessment impossible for projects that haven't yet curated one.

## Decision

**CLI consolidation**: Hard-remove `virage eval`, `virage eval-suite`, and `virage benchmark`. Replace with a single `virage quality` top-level command (alias `ql`) that groups all tooling under one roof:

```
virage quality                    # 26-metric self-assessment (default action)
virage quality eval run           # dataset-based retrieval eval
virage quality eval generate      # dataset generation
virage quality eval save/list/compare  # experiment tracking
virage quality suite run          # multi-config eval suite
virage quality bench embedder/chunker/reranker  # latency benchmarks
virage quality history list/show  # historical run browser
```

**26-metric intrinsic self-assessment** — `virage quality` with no arguments runs a complete pipeline self-assessment without requiring an eval dataset. It samples up to 500 chunks from the local index and computes 26 metrics across 8 pipeline components:

1. Chunking (Cohesion, Integrity, Coherence, Coverage)
2. Metadata Extraction (Completeness, BreadcrumbConsistency, FQNCompleteness, ImportResolution, SiblingIntegrity)
3. Dense Input Prep (TextPurity, EnrichmentQuality)
4. Dense Embedding (SelfRecall@K, IntrinsicDimension, Uniformity, Isotropy, OutlierFraction)
5. Sparse Input Prep (TermCoverage, TermSparsity) — optional, skipped if no sparse store
6. Lexical Retrieval (LexicalRecall@K) — optional, skipped if FTS unavailable
7. Reranker Input (FeatureCompleteness, FeatureAblationImpact, FeatureRedundancy, InputConsistency) — optional
8. Reranker (Uplift, Calibration, ConfidenceGap) — optional

**Must-pass thresholds**: three metrics are must-pass gates — if any fail, `overall = 0` and `status = FAIL` regardless of other scores:
- `SelfRecall@K > 0.80` (chunks must be findable via their own text)
- `OutlierFraction < 0.05` (at most 5% of embeddings are statistical outliers)
- `ImportResolution > 0.70` (at least 70% of import statements resolve)

**Weighted scoring**: Each metric is normalized to [0, 1] (direction-adjusted) with a weight. Component scores are weighted averages of their metrics. Overall score is a weighted average of component scores. Pass threshold: `overall ≥ 0.70 AND all must-pass gates passed`.

**RAGBench integration**: `--benchmark <path>` / `--ragbench <path>` adds standard TREC qrels evaluation alongside the existing JSON dataset format, computing MRR@K, NDCG@K, Recall@K, Precision@K, HitRate@K.

**Historical tracking**: `--history` saves the full `QualityReport` to `.virage/quality-history/<timestamp>-quality.json` and also writes `benchmark-data.json` in `benchmark-action/github-action-benchmark` format (normalized [0,1] scores, `customBiggerIsBetter`). A shields.io badge JSON is also written for the README quality badge.

**GitHub Actions**: A `workflow_dispatch`-only `quality.yml` workflow runs the self-assessment, feeds results to `benchmark-action/github-action-benchmark` for GitHub Pages charts, and commits the updated badge to `gh-pages`.

**Config extension**: A `quality` section in `virage.config.json` allows per-deployment threshold and weight overrides. CLI flags override config, which overrides model defaults.

## Normalization rules

| Metric shape | Formula |
|---|---|
| Monotonic ↑, range [0,1] | `v` (identity) |
| Monotonic ↑, range [-1,1] | `(v+1)/2` |
| Monotonic ↓, range [0,1] | `1 - v` |
| Intrinsic Dimension (non-monotonic) | Piecewise: 0→1 to 70%, plateau to 90%, 1→0 from 90% |
| Uniformity (non-monotonic) | Piecewise: 0→1 to 0.7, plateau to 0.85, 1→0 from 0.85 |
| Coherence (non-monotonic) | Piecewise: 0→1 to 0.4, plateau to 0.6, 1→0 from 0.6 |
| Calibration | `1 - |mean - 0.5| - |std - 0.25|`, clamped [0,1] |

## Consequences

- **Breaking change**: `virage eval`, `virage eval-suite`, `virage benchmark` are removed. CI scripts referencing these commands must be updated in the same PR.
- All 26 metrics are implemented in `packages/virage-core/src/quality/` and exported through the public API.
- PCA for IntrinsicDimension uses power iteration with deflation (no external library dependency, max 64 components).
- Components 5–8 are optional and skip gracefully when the corresponding pipeline feature is not configured.
- The quality history format is compatible with `benchmark-action/github-action-benchmark@v1` (customBiggerIsBetter mode).
