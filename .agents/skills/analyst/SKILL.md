---
name: analyst
description: Read and interpret pipeline telemetry, vector store metrics, and eval results to diagnose issues or assess performance.
license: MIT
metadata:
  author: vivantel-team
  version: "1.0.0"
---

# Skill: Analyst — Telemetry, Observability, Diagnostics

**Purpose:** Read and interpret pipeline telemetry, vector store metrics, and eval results to diagnose issues or assess performance.

---

## When to use this skill

- User asks to diagnose pipeline performance or bottlenecks
- Interpreting telemetry, eval results, or vector store metrics
- Debugging slow, incorrect, or stalled pipeline runs
- Inspecting the embeddings DB or running diagnostic queries

---

## Context checklist

```
[ ] Confirm the pipeline has run at least once (artifacts must exist before reading them)
[ ] Identify what you need: telemetry / store stats / store perf / eval results / chunk quality
```

---

## Current State — Artifact locations

| Artifact           | Default path                         | Format        | Contents                                                      |
| ------------------ | ------------------------------------ | ------------- | ------------------------------------------------------------- |
| Embeddings DB      | `.virage/embeddings.db`              | SQLite STRICT | Chunk metadata, embedding BLOBs (Float32 LE), `uploaded` flag |
| Telemetry          | `.virage/telemetry.json`             | JSON          | Per-stage pipeline performance metrics                        |
| Eval datasets      | `.rag-experiments/`                  | JSON files    | Query + ground-truth pairs                                    |
| Experiment results | `.rag-experiments/<name>_<iso>.json` | JSON          | Metrics: MRR, P@5, R@10, HitRate@5                            |

**Override paths**: set `VIRAGE_DIR` env var to change the `.virage/` root.

> **Keep this table current.** After adding a new artifact type or changing default paths, update this snapshot.

---

## Diagnostic commands

```bash
virage report [--dir <path>]    # telemetry summary from .virage/telemetry.json
virage store stats               # vector index quality metrics (coverage, dimensionality, etc.)
virage store perf                # query latency: p50 / p95 / p99
virage chunks report             # chunk cohesion quality metrics from embeddings.db
virage viz embeddings            # 2D UMAP or t-SNE visualization of the embedding space
```

---

## Telemetry structure

`TelemetryCollector` (`packages/virage-core/src/core/telemetry.ts`) records per-stage:

| Stage        | Metrics captured                                    |
| ------------ | --------------------------------------------------- |
| Git tracking | Duration, file count, files changed                 |
| Chunking     | Duration, chunks produced, files processed          |
| Embedding    | Latency per batch, total latency, rate-limit events |
| Upload       | Latency per batch, total latency, retry events      |

Auto-saved to `.virage/telemetry.json` after each pipeline run. `virage report` reads and displays it.

---

## Eval metrics reference

| Metric    | Range | Description                                                           |
| --------- | ----- | --------------------------------------------------------------------- |
| MRR       | 0–1   | Mean Reciprocal Rank — average rank position of first relevant result |
| P@5       | 0–1   | Precision at 5 — fraction of top-5 results that are relevant          |
| R@10      | 0–1   | Recall at 10 — fraction of relevant results found in top 10           |
| HitRate@5 | 0–1   | Fraction of queries where a relevant result appears in top 5          |

Bootstrap significance test (`virage experiment compare`): delta per metric, p-value, confidence interval, recommendation label (accept / reject / inconclusive).

---

## Pipeline verbosity flags for live diagnosis

```bash
virage index -v        # verbosity 1: basic progress
virage index -vvvvv    # verbosity 5: full debug (all provider calls, batch sizes, timings)
virage index --dry-run # show what would change without uploading
virage index --no-upload  # chunk + embed but skip vector store upload
```

---

## Embeddings DB inspection (direct SQLite)

The DB schema uses `STRICT` mode. Useful queries:

```sql
-- chunk count
SELECT COUNT(*) FROM chunks;

-- pending embed count
SELECT COUNT(*) FROM chunks WHERE embedding IS NULL;

-- pending upload count
SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL AND uploaded = 0;

-- file list with chunk counts
SELECT source_file, COUNT(*) AS chunks FROM chunks GROUP BY source_file;
```

Run with: `sqlite3 .virage/embeddings.db '<query>'`
