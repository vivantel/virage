# Virage Quality Improvement Plan

**Source Analysis**: [docs/virage-quality-analysis.md](virage-quality-analysis.md)
**Current Score**: 69.2% FAIL (target: ≥70% PASS)
**Date**: 2026-10-04

---

## Plan Overview

| Group | Priority | Description | Target Impact |
|-------|----------|-------------|---------------|
| **A** | P0 | Metadata Extraction & Chunking Foundation | +15-20% overall |
| **B** | P0 | Quick Wins (SelfRecall threshold) | +2-3% overall |
| **C** | P1 | Embedding Space Quality | +5-8% overall |
| **D** | P1 | Reranker Pipeline Integration | Unlocks 2 components |
| **E** | P2 | Cross-File Intelligence | Strategic enabler |
| **F** | P2 | WASM Plugin Ecosystem | Strategic enabler |

---

## Group A: Metadata Extraction & Chunking Foundation (P0)

**Cohesion**: All tasks touch `crates/virage-engine/src/chunkers/lang.rs` and quality metrics

### A1: Add FQN Extraction to Lang Chunker
- **File**: `crates/virage-engine/src/chunkers/lang.rs`
- **Metric**: `FQNCompleteness` (currently 0%)
- **Approach**: Per-language tree-sitter queries for class/function definitions
- **Dependencies**: None
- **Effort**: M

### A2: Add Import Extraction & Resolution
- **File**: `crates/virage-engine/src/chunkers/lang.rs`
- **Metrics**: `ImportResolution` (must-pass, currently 0%), `Completeness`
- **Approach**: Tree-sitter queries for import statements + project-level resolution
- **Dependencies**: A1 (same chunker pass)
- **Effort**: M

### A3: Add AST Node Counts for Integrity
- **File**: `crates/virage-engine/src/chunkers/lang.rs`
- **Metric**: `Integrity` (currently 0% - skipped)
- **Approach**: Count `is_definition` nodes total vs in-bounds during parsing
- **Dependencies**: None
- **Effort**: S

### A4: Add Sibling Linking (Prev/Next)
- **File**: `crates/virage-engine/src/chunkers/lang.rs` + pipeline coordinator
- **Metrics**: `SiblingIntegrity` (100%), `Completeness`
- **Approach**: Set `siblingPrev`/`siblingNext` in chunk metadata during emission
- **Dependencies**: Chunk ordering stable
- **Effort**: S

### A5: Tune Chunk Size / Overlap for Coverage
- **File**: `virage.config.json` + `crates/virage-engine/src/quality/metrics/chunking.rs`
- **Metric**: `Coverage` (currently 59%)
- **Approach**: Adjust `token_range_min`/`token_range_max` to match actual chunk distribution
- **Dependencies**: None
- **Effort**: S

---

## Group B: Quick Wins (P0)

### B1: Fix SelfRecall@K Threshold Comparison
- **File**: `crates/virage-engine/src/quality/scoring.rs`
- **Issue**: `mustPassPassed: false` at exactly 0.80 (uses `>` not `>=`)
- **Fix**: Change threshold check from `value > threshold` to `value >= threshold`
- **Effort**: XS
- **Impact**: Must-pass gate passes, unblocks PASS status

---

## Group C: Embedding Space Quality (P1)

### C1: Evaluate Alternative Embedding Models
- **Files**: `virage.config.json`, `crates/virage-engine/src/embedders/onnx.rs`
- **Metrics**: `IntrinsicDimension` (19%), `Isotropy` (7%), `SelfRecall@K`
- **Approach**: Test `BAAI/bge-small-en-v1.5` (384d) vs current `all-MiniLM-L6-v2`
- **Effort**: S (config change + re-index + eval)

### C2: Add Post-Processing Normalization (Whitening)
- **File**: `crates/virage-engine/src/embedders/onnx.rs`
- **Metrics**: `Isotropy`, `Uniformity`, `IntrinsicDimension`
- **Approach**: PCA whitening or L2 normalization after embedding
- **Effort**: M

### C3: Config-Driven Model Selection
- **File**: `virage.config.json` schema + embedder options
- **Approach**: Allow `dimensions` and `model` as config options with validation
- **Effort**: S

---

## Group D: Reranker Pipeline Integration (P1)

### D1: Wire Cross-Encoder Reranker into Pipeline
- **Files**: `crates/virage-engine/src/pipeline/coordinator.rs`, `crates/virage-engine/src/rerankers/cross_encoder.rs`
- **Metrics**: Unlocks `RerankerInput` + `Reranker` components (currently 0%)
- **Approach**: Add reranker step after vector search, before results returned
- **Dependencies**: Config schema for reranker
- **Effort**: M

### D2: Add Reranker Config to virage.config.json
- **File**: `virage.config.json` + config schema
- **Approach**: Add `providers.reranker` block with `builtin: "cross-encoder"`
- **Effort**: S

---

## Group E: Cross-File Intelligence (P2 - Strategic)

### E1: Project Symbol Index (Per-File Exports)
- **Files**: New module in `crates/virage-engine/src/symbols/`
- **Enables**: `ImportResolution`, `FQNCompleteness` cross-file
- **Approach**: Extract exported symbols per file, build global symbol table
- **Effort**: L

### E2: Cross-File Import Resolution
- **Files**: Pipeline integration + symbol index
- **Metric**: `ImportResolution` (must-pass)
- **Approach**: Resolve import paths against symbol index
- **Dependencies**: E1
- **Effort**: L

---

## Group F: WASM Plugin Ecosystem (P2 - Strategic)

### F1: WASM Chunker SDK / Template
- **Files**: New crate + documentation
- **Approach**: Publish template for community chunkers
- **Effort**: M

### F2: Extend WIT Worlds (Source, Embedder)
- **Files**: `wit/worlds/`
- **Approach**: Add `source.wit`, `embedder.wit` for full plugin coverage
- **Effort**: M

---

## Execution Order

```
Week 1:  B1 → A5 → A3 → A4 → A1 → A2
Week 2:  C1 → C3 → C2
Week 3:  D2 → D1
Month 2: E1 → E2
Month 3: F1 → F2
```

---

## Dependencies Graph

```
B1 (XS)
  ↓
A5 (S) ──┐
A3 (S) ──┤ → A1 (M) → A2 (M)
A4 (S) ──┘
  ↓
C1 (S) → C3 (S) → C2 (M)
  ↓
D2 (S) → D1 (M)
  ↓
E1 (L) → E2 (L)
  ↓
F1 (M) → F2 (M)
```

---

## Acceptance Criteria per Group

| Group | Metric | Target |
|-------|--------|--------|
| A | Metadata Extraction score | ≥ 80% |
| A | Chunking score | ≥ 80% |
| B | SelfRecall@K must-pass | PASS |
| C | Dense Embedding score | ≥ 80% |
| D | Reranker components | Not skipped |
| Overall | Quality score | ≥ 70% PASS |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Tree-sitter query complexity per language | Start with Rust + TypeScript (highest coverage), add others incrementally |
| Import resolution requires full project index | Phase 1: intra-file only; Phase 2: cross-file (Group E) |
| Embedding model change requires re-index | Use `virage index --force`; cache models in `.virage/model-cache` |
| Reranker adds latency | Configurable `rerankOversample` (default 3); benchmark before enabling |

---

## Next Steps

1. **Approve plan** → Begin Group A + B implementation
2. **Confirm embedding model candidates** for C1
3. **Decide reranker priority** (D1 vs E1)
4. **Assign owners** per task