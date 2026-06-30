# virage quality

The `quality` command (alias `ql`) is Virage's unified quality system. It covers three distinct concerns:

- **Self-assessment** — 26 pipeline-intrinsic metrics computed directly from your index, requiring no ground-truth labels
- **Retrieval evaluation** — precision, MRR, recall measured against an eval dataset or RAGBench qrels file
- **Performance benchmarking** — latency and throughput for embedders, chunkers, and rerankers

---

## Self-assessment (default action)

Running `virage quality` with no subcommand executes the 26-metric self-assessment and prints a scored table.

```
virage quality [options]

Options:
  --components           Run pipeline component metrics (default: true)
  --benchmark <path>     Also run RAGBench evaluation from qrels/JSON file
  --history              Save this run to .virage/quality-history/
  --fail-fast            Exit 1 on any MUST-PASS threshold violation
  --json                 Output as machine-readable JSON
  --markdown             Output as Markdown table (for PR comments / CI summaries)
  --output <path>        Write report to file
  --sample-size <n>      Chunks to sample for expensive metrics (default: 500)
  --k <n>                Top-K for retrieval metrics (default: 10)
  -c, --config <path>    Config file (default: virage.config.json)
```

### The 26-metric model

Metrics are organised into 8 pipeline components. Optional components (5–8) are skipped gracefully when the relevant pipeline feature is not configured.

| # | Component | Metrics |
|---|-----------|---------|
| 1 | Chunking | Cohesion, Integrity, Coherence, Coverage |
| 2 | Metadata extraction | Completeness, Breadcrumb Consistency, FQN Completeness, Import Resolution, Sibling Integrity |
| 3 | Dense input prep | Text Purity, Enrichment Quality |
| 4 | Dense embedding | Self-Recall@K, Intrinsic Dimension, Uniformity, Isotropy, Outlier Fraction |
| 5 | Sparse input prep | Term Coverage, Term Sparsity |
| 6 | Lexical retrieval | Lexical Recall@K |
| 7 | Reranker input | Feature Completeness, Feature Ablation Impact, Feature Redundancy, Input Consistency |
| 8 | Reranker | Uplift (ΔMRR), Calibration, Confidence Gap |

**Must-pass gates** — three metrics gate the overall result regardless of weighted score:

| Metric | Threshold | Direction |
|--------|-----------|-----------|
| Self-Recall@K | > 0.80 | ↑ |
| Outlier Fraction | < 0.05 | ↓ |
| Import Resolution | > 0.70 | ↑ |

The overall score must also reach ≥ 0.70 for status `PASS`. Any must-pass violation forces `FAIL`.

### Config extension

Override thresholds and metric weights per-project via the `quality` key in `virage.config.json`:

```json
{
  "quality": {
    "thresholds": {
      "selfRecall": 0.80,
      "outlierFraction": 0.05,
      "importResolution": 0.70
    },
    "weights": {
      "cohesion": 2.0,
      "integrity": 2.0,
      "selfRecall": 3.0
    },
    "history": {
      "dir": ".virage/quality-history",
      "maxRuns": 100
    }
  }
}
```

### RAGBench evaluation

Pass `--benchmark <path>` to run a standard retrieval evaluation alongside the self-assessment. The path can point to a JSON file (`{queries: [{id, query, qrels: [{docId, relevance}]}]}`) or a TREC qrels file (`queryId 0 docId relevance` lines).

Results are appended to the report as a separate RAGBench section showing MRR@K, NDCG@K, Recall@K, Precision@K, and HitRate@K.

### History

`--history` saves the full `QualityReport` to `.virage/quality-history/<timestamp>-quality.json`. It also writes:

- `benchmark-data.json` — `[{name, unit, value}]` format for `benchmark-action/github-action-benchmark`
- `quality-badge.json` — shields.io endpoint format (`{schemaVersion, label, message, color}`) for the README quality badge

---

## virage quality eval

Retrieval evaluation against an eval dataset. Measures Precision@5, MRR, Recall@10, HitRate@5.

```
virage quality eval run [options]

Options:
  -c, --config <path>       Config file (default: virage.config.json)
  -d, --dataset <path>      Eval dataset path (default: .virage/eval-dataset.json)
  --ragbench <path>         Also run RAGBench evaluation from qrels/JSON at this path
  --threshold-mrr <n>       Fail if MRR is below this value
  --ci                      Exit 1 if quality gate fails
  --with-llm-judge          Enable RAGAS LLM-as-judge metrics
  --suite <type>            Evaluation suite: retrieval (default) or ecosystem
```

```
virage quality eval generate [options]    Generate a dataset from indexed chunks

Options:
  --output <path>           Output path (default: .virage/eval-dataset.json)
  --include-negatives       Add negative examples
  --paraphrase-ratio <n>    Fraction of queries to paraphrase (0–1, default: 0)
```

```
virage quality eval save --name <name>    Run evaluation and save as a named experiment
virage quality eval list                  List all saved experiment runs
virage quality eval compare --baseline <id> --candidate <id>
                                          Bootstrap significance test between two runs
```

**Typical workflow:**

```bash
# Establish a baseline
virage quality eval save --name baseline-v1

# Change embedder or chunker config, re-index
virage index --force

# Measure again
virage quality eval save --name fastembed-bge

# Compare with p-value and 95% CI
virage quality eval compare --baseline baseline-v1 --candidate fastembed-bge
```

---

## virage quality history

Browse and inspect past self-assessment runs saved with `--history`.

```
virage quality history list               Show a table of saved runs (timestamp, score, status)
virage quality history show <id>          Show a full report for a run (use -v for raw JSON)
```

History is stored in `.virage/quality-history/`. The `<id>` argument accepts any unique prefix of the timestamp filename.

---

## virage quality suite

Multi-config evaluation suite: downloads pre-built archive pairs and compares search strategies across multiple configurations.

```
virage quality suite run --suite <path> [options]

Options:
  --suite <path>    Path to eval suite config JSON (required)
  --ci              Exit 1 if the CI quality gate fails
  --json            Output raw JSON results
  --no-cache        Re-download archives even if already cached
```

---

## virage quality bench

Performance benchmarking for embedders, chunkers, and rerankers. Reports latency percentiles (p50/p95/p99) and throughput.

```
virage quality bench embedder [options]

Options:
  -c, --config <path>    Config file (default: virage.config.json)
  -s, --samples <n>      Number of latency samples (default: 20)
  -w, --warmup <n>       Warm-up runs (default: 3)
```

```
virage quality bench chunker <files...> [options]

Options:
  -c, --config <path>    Config file (default: virage.config.json)
  -s, --samples <n>      Passes per chunker (default: 20)
  -w, --warmup <n>       Warm-up runs (default: 3)
```

```
virage quality bench reranker [options]

Options:
  -c, --config <path>    Config file (default: virage.config.json)
  -s, --samples <n>      Number of rerank calls (default: 20)
  --passages <n>         Passages per rerank call (default: 10)
  -w, --warmup <n>       Warm-up runs (default: 3)
```

---

## GitHub Actions integration

See `.github/workflows/quality.yml` for the manual-trigger workflow that runs the full self-assessment, publishes benchmark data to `gh-pages` via `benchmark-action/github-action-benchmark`, and updates the quality badge.
