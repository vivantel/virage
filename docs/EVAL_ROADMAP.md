# Eval Quality Roadmap

This document tracks the state and next steps for Virage's retrieval quality evaluation infrastructure.

---

## What's been built

| Artifact | Location | Purpose |
|---|---|---|
| Quality evaluation dataset | `eval/quality-evaluation.json` | 15 ground-truth query/answer pairs for this repo |
| Eval suite config | `eval/suites/retrieval-quality.json` | Declarative 4-variant eval: vector, hybrid, vector+reranker, hybrid+reranker |
| Eval suite runner | `virage eval-suite run` | Downloads DB archives from HTTPS, installs pinned plugins, runs all variants, compares vs baseline |
| DB archive packer | `virage pack` | Packs a LanceDB directory into a `.tar.gz` for upload and suite reference |
| Eval matrix script | `scripts/eval-matrix.sh` | Shell wrapper: runs `virage eval save` per config + `virage eval compare` vs baseline |
| Query matrix script | `scripts/query-matrix.sh` | Runs `virage query` for every config × query combination; separation-based noise gate |

### Plugin version isolation

`virage eval-suite run` creates a content-addressed directory under `.virage/eval-cache/runs/<key>/` for each (database archive + plugin version combo). This directory holds:
- `lancedb/` — extracted DB archive
- `plugins/` — npm-installed plugin packages at the declared versions

Before loading config for each variant, the runner temporarily sets `VIRAGE_DIR` to that directory so `importPackage()` resolves plugins from there instead of the global plugin dir.

---

## Measured baselines

| Variant | MRR@10 | P@5 | HR@5 |
|---|---|---|---|
| vector (baseline) | ~0.48 | ~0.38 | ~0.60 |
| hybrid | ~0.50 | ~0.40 | ~0.63 |
| vector-cross-encoder | ~0.55 | ~0.47 | ~0.73 |
| hybrid-cross-encoder | ~0.58 | ~0.50 | ~0.77 |

Dataset: `eval/quality-evaluation.json` (15 queries). All variants use `minilm-384-ast` (all-MiniLM-L6-v2, 384d, AST+Markdown chunking, this repo's master branch).

> The 15-query dataset has high variance — these numbers are directionally correct but not statistically decisive. Expand the dataset to reduce noise.

---

## Next steps (ordered by expected impact)

### 1. Upload `minilm-384-ast.tar.gz` to GitHub releases

The suite config in `eval/suites/retrieval-quality.json` references a GitHub releases URL. Until the archive is uploaded, `virage eval-suite run` will fail on a clean clone.

```bash
virage pack --output minilm-384-ast.tar.gz --database .virage/lancedb
# Then upload to: https://github.com/vivantel/virage/releases/tag/eval-db
```

Update `eval/suites/retrieval-quality.json` with the sha256 of the uploaded archive.

---

### 2. Add `prefetchMultiplier` to cross-encoder config

The cross-encoder currently retrieves `topK × rerankOversample` candidates (default 5×). Increasing this to 10–20× before reranking significantly expands the candidate pool, especially for hybrid search where BM25 and vector results complement each other.

Expected improvement: MRR +0.10–0.15.

```json
{
  "search": {
    "rerankOversample": 20,
    "reranker": {
      "package": "@vivantel/virage-reranker-cross-encoder",
      "config": { "model": "Xenova/ms-marco-MiniLM-L-6-v2", "topK": 10 }
    }
  }
}
```

Add `virage.config.hybrid.cross-encoder-20x.json` and a new variant to `eval/suites/retrieval-quality.json`.

---

### 3. Expand the quality evaluation dataset (15 → 40+ queries)

The current 15-query dataset produces noisy MRR estimates (±0.05 with 10k bootstrap). At 40+ queries the confidence intervals narrow to ±0.02, making smaller improvements detectable.

Guidelines for new queries:
- **Positive queries**: target specific functions, types, config fields, and ADR decisions that exist in the codebase
- **Hard negatives**: semantically related but not answerable queries (e.g., "how to index a Postgres database" — Virage supports Postgres but the answer is in config docs, not the codebase)
- **Exact-term queries**: short queries testing BM25 (e.g., `"rrfMerge"`, `"bootstrapPairedTest"`)

Run `virage eval-suite run` before and after adding queries to confirm the MRR delta is within noise.

---

### 4. Multi-embedder comparison

Each embedder requires its own DB archive (different embedding dimensions). Planned comparisons:

| Archive name | Model | Dimensions |
|---|---|---|
| `minilm-384-ast` ✓ | all-MiniLM-L6-v2 | 384 |
| `bge-small-384-ast` | BAAI/bge-small-en-v1.5 | 384 |
| `multilingual-e5-384-ast` | intfloat/multilingual-e5-small | 384 |
| `minilm-384-token` | all-MiniLM-L6-v2 | 384 (token chunking) |

Steps: run `virage index` with each config, `virage pack`, upload to releases, add to `eval/suites/retrieval-quality.json`.

---

### 5. Wire `virage eval-suite run --ci` into `rag-eval.yml`

The CI gate (`ciGate.mrr: 0.35` in `eval/suites/retrieval-quality.json`) should fail the workflow when the baseline drops below the threshold.

```yaml
# .github/workflows/rag-eval.yml
- name: Run eval suite
  run: |
    node packages/virage-cli/dist/bin/virage.js eval-suite run \
      --suite eval/suites/retrieval-quality.json --ci
```

This requires the DB archive to be uploaded (step 1) and the runner installed via `npm ci`.

---

### 6. Track eval history in virage.db

Currently each `virage eval-suite run` saves `ExperimentRun` rows to the local `virage.db` but there is no time-series view. Add an `eval_suite_run` table that records suite-level aggregates (timestamp, suite version, variant count, baseline MRR) and wire it into the dashboard's "Eval History" panel.

This allows spotting regressions across releases without re-running comparisons manually.
