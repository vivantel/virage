---
name: qa
description: Set up, run, and debug tests; generate eval datasets; run experiments; interpret quality metrics.
license: MIT
when_to_use:
  - "Writing or debugging unit, integration, or acceptance tests"
  - "Generating an eval dataset for RAG quality measurement"
  - "Running virage evaluate or virage experiment and interpreting results"
  - "Diagnosing a test failure or flaky test in CI"
prerequisites: []
estimated_tokens: 1360
output_format: "Test files, eval dataset, or diagnostic report with pass/fail analysis"
metadata:
  author: vivantel-team
  version: "1.1.0"
---

# Skill: QA — Tests, Eval, Quality Metrics

**Purpose:** Set up, run, and debug tests; generate eval datasets; run experiments; interpret quality metrics.

---

## When to use this skill

- Running unit, acceptance, or type-check tests
- Setting up new test infrastructure or a new test type
- Generating eval datasets and running retrieval experiments
- Interpreting eval metrics (MRR, P@5, R@10, HitRate@5)

---

## Context checklist

```
[ ] Identify what you're testing: unit / acceptance / type-check / eval / quality
[ ] For acceptance tests: build virage-store-test first
      npm run build -w @vivantel/virage-store-test
[ ] For acceptance tests: set E2E_CLONE_DIR to reuse an existing clone (skips slow clone step)
      export E2E_CLONE_DIR=/path/to/existing/clone
[ ] Before committing: npm run fix && npm run lint && npm run type-check:ci (see .agents/skills/code-guardian/SKILL.md)
```

---

## Current State — Test type map

| Type             | Command                                            | Location                                | Notes                                     |
| ---------------- | -------------------------------------------------- | --------------------------------------- | ----------------------------------------- |
| Unit             | `npm test -w @vivantel/<pkg>`                      | `packages/<pkg>/src/**/*.test.ts`       | Per-package vitest                        |
| Acceptance (E2E) | `npm run test:acceptance -w @vivantel/virage-core` | `packages/virage-core/test/acceptance/` | Full CLI, 6-min timeout, forked processes |
| Type check       | `npm run type-check:ci`                            | All included packages                   | tsc --noEmit                              |
| Coverage         | `npm run test:coverage -w @vivantel/<pkg>`         | Same as unit                            | HTML output                               |
| Single file      | `npx vitest run src/core/<file>.test.ts`           | Any package                             | Run from package dir                      |

**Type-check exclusions**: `virage-embedder-openai`, `virage-embedder-transformers`, and `virage-store-lancedb` are excluded from `type-check:ci`. The embedder packages have corrupted third-party `.d.ts` files from a broken `npm install` that predates the project (run `npm ci` in those packages individually to restore). `virage-store-lancedb` is excluded because `@lancedb/lancedb` is missing from `node_modules` (disk-space constraint prevented installation).

> **Keep this table current.** After adding a new test type or test infrastructure, add a row.

---

## Acceptance test setup

- Separate vitest config: `packages/virage-core/vitest.acceptance.config.ts`
- Uses `virage-store-test` (file-backed mock VectorStore at `packages/virage-store-test/`)
- Each test file runs in a forked process
- `E2E_CLONE_DIR` env var: reuses an existing repo clone to skip the slow `git clone` step during iteration

---

## Eval workflow

### 1. Generate eval dataset

```bash
virage eval-generate
```

Reads chunks from `.virage/virage.db`, generates query–ground-truth pairs. Output: `.virage/eval-dataset.json` (override with `--output`).

### 2. Run an experiment

```bash
virage experiment run --name <name>
```

Runs the RAG pipeline against the eval dataset and persists results.  
Results saved to the `experiment_runs` table in `.virage/virage.db`.  
Metrics collected: MRR, P@5, R@10, HitRate@5.

### 3. Compare experiments

```bash
virage experiment compare --baseline <id> --candidate <id>
```

Runs a bootstrap significance test. Outputs: delta per metric, p-value, confidence interval, recommendation (accept / reject / inconclusive).

### 4. List saved experiments

```bash
virage experiment list
```

---

## Quality metrics

**Chunk quality** (`packages/virage-core/src/strategies/chunk/quality-metrics.ts`):

```bash
virage chunks report   # reads virage.db, prints cohesion metrics
```

- `ChunkQualityMetrics` interface: `src/interfaces/quality.ts`
- `computeChunkQualityMetrics()`: standalone function, usable without a full strategy instance
- `ChunkStrategy.getQualityMetrics?(chunks)`: optional hook on strategy objects

**Embedding quality** (`virage store stats`, `virage store perf`) — see `.agents/skills/analyst/SKILL.md`.

---

## Eval source files (`packages/virage-core/src/eval/`)

| File                  | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `generator.ts`        | Build eval datasets from existing chunks                   |
| `runner.ts`           | Execute evaluation with metric collection                  |
| `ragas.ts`            | RAGAS LLM-as-judge integration (requires OpenAI embedder)  |
| `metrics.ts`          | Precision / recall / NDCG computation                      |
| `statistics.ts`       | Bootstrap confidence intervals, significance tests         |
| `adaptive-tuner.ts`   | Grid-search over chunker parameters                        |
| `experiment-store.ts` | Persist/load experiment runs; ID: `<name>_<iso-timestamp>` |
| `dataset-io.ts`       | Read/write eval datasets                                   |
