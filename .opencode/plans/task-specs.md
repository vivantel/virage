# Task Specifications (JSON)

```json
[
  {
    "id": "B1",
    "group": "B",
    "priority": "P0",
    "owner": "QualityAgent",
    "files": ["crates/virage-engine/src/quality/scoring.rs"],
    "acceptance": [
      "SelfRecall@K mustPassPassed = true when value == 0.80",
      "Threshold comparison uses >= not >",
      "virage quality run --format json shows mustPassPassed: true"
    ],
    "dependencies": [],
    "effort": "XS"
  },
  {
    "id": "A5",
    "group": "A",
    "priority": "P0",
    "owner": "ConfigAgent",
    "files": ["virage.config.json", "crates/virage-engine/src/quality/metrics/chunking.rs"],
    "acceptance": [
      "Coverage metric >= 80%",
      "token_range_min/token_range_max in config match actual chunk distribution",
      "virage quality run --format json shows Coverage normalizedValue >= 0.8"
    ],
    "dependencies": [],
    "effort": "S"
  },
  {
    "id": "A3",
    "group": "A",
    "priority": "P0",
    "owner": "ChunkerAgent",
    "files": ["crates/virage-engine/src/chunkers/lang.rs"],
    "acceptance": [
      "Integrity metric not skipped",
      "astNodeCount and astNodeCountInBounds populated in chunk metadata",
      "virage quality run --format json shows Integrity normalizedValue > 0"
    ],
    "dependencies": [],
    "effort": "S"
  },
  {
    "id": "A4",
    "group": "A",
    "priority": "P0",
    "owner": "ChunkerAgent",
    "files": ["crates/virage-engine/src/chunkers/lang.rs", "crates/virage-engine/src/pipeline/coordinator.rs"],
    "acceptance": [
      "siblingPrev and siblingNext populated for all chunks in sequence",
      "SiblingIntegrity metric = 1.0 (100%)",
      "virage quality run --format json shows SiblingIntegrity normalizedValue = 1.0"
    ],
    "dependencies": [],
    "effort": "S"
  },
  {
    "id": "A1",
    "group": "A",
    "priority": "P0",
    "owner": "ChunkerAgent",
    "files": ["crates/virage-engine/src/chunkers/lang.rs"],
    "acceptance": [
      "FQNCompleteness metric >= 80%",
      "fqn field populated for Rust + TypeScript code chunks",
      "Tree-sitter queries for function/class/struct/trait definitions",
      "virage quality run --format json shows FQNCompleteness normalizedValue >= 0.8"
    ],
    "dependencies": ["A3", "A4"],
    "effort": "M"
  },
  {
    "id": "A2",
    "group": "A",
    "priority": "P0",
    "owner": "ChunkerAgent",
    "files": ["crates/virage-engine/src/chunkers/lang.rs"],
    "acceptance": [
      "ImportResolution metric >= 70% (must-pass)",
      "imports array + totalImports/resolvedImports counts populated",
      "Intra-file import resolution works (Phase 1)",
      "virage quality run --format json shows ImportResolution normalizedValue >= 0.7, mustPassPassed: true"
    ],
    "dependencies": ["A1"],
    "effort": "M"
  },
  {
    "id": "C1",
    "group": "C",
    "priority": "P1",
    "owner": "EmbedderAgent",
    "files": ["virage.config.json", "crates/virage-engine/src/embedders/onnx.rs"],
    "acceptance": [
      "Test BAAI/bge-small-en-v1.5 vs all-MiniLM-L6-v2",
      "IntrinsicDimension >= 50% (currently 19%)",
      "Isotropy >= 30% (currently 7%)",
      "Decision documented with MRR comparison"
    ],
    "dependencies": ["A2"],
    "effort": "S"
  },
  {
    "id": "C3",
    "group": "C",
    "priority": "P1",
    "owner": "ConfigAgent",
    "files": ["virage.config.json", "crates/virage-engine/src/config/mod.rs", "crates/virage-engine/src/config/resolve.rs"],
    "acceptance": [
      "Embedder config accepts model + dimensions options",
      "Schema validates model exists in ONNX model zoo",
      "Config change triggers re-index on dimension mismatch"
    ],
    "dependencies": ["C1"],
    "effort": "S"
  },
  {
    "id": "C2",
    "group": "C",
    "priority": "P1",
    "owner": "EmbedderAgent",
    "files": ["crates/virage-engine/src/embedders/onnx.rs"],
    "acceptance": [
      "Post-embedding normalization (L2 or PCA whitening) implemented",
      "Isotropy >= 50%",
      "Uniformity in target range 0.7-0.85",
      "No regression in SelfRecall@K"
    ],
    "dependencies": ["C3"],
    "effort": "M"
  },
  {
    "id": "D2",
    "group": "D",
    "priority": "P1",
    "owner": "ConfigAgent",
    "files": ["virage.config.json", "crates/virage-engine/src/config/mod.rs"],
    "acceptance": [
      "providers.reranker block with builtin: cross-encoder",
      "Options: model, cacheDir configurable",
      "Schema validation passes"
    ],
    "dependencies": ["C2"],
    "effort": "S"
  },
  {
    "id": "D1",
    "group": "D",
    "priority": "P1",
    "owner": "PipelineAgent",
    "files": ["crates/virage-engine/src/pipeline/coordinator.rs", "crates/virage-engine/src/rerankers/cross_encoder.rs", "crates/virage-engine/src/rerankers/mod.rs"],
    "acceptance": [
      "Reranker step executes after vector search, before return",
      "RerankerInput component not skipped (FeatureCompleteness > 0)",
      "Reranker component not skipped (Uplift measured)",
      "rerankOversample config respected (default 3)"
    ],
    "dependencies": ["D2"],
    "effort": "M"
  },
  {
    "id": "E1",
    "group": "E",
    "priority": "P2",
    "owner": "SymbolsAgent",
    "files": ["crates/virage-engine/src/symbols/mod.rs (new)", "crates/virage-engine/src/symbols/index.rs (new)", "crates/virage-engine/src/symbols/resolution.rs (new)"],
    "acceptance": [
      "Per-file symbol extraction (exports: functions, classes, types)",
      "Global symbol table built during indexing",
      "Symbol ID format: filePath::symbolName",
      "Exposed via pipeline for cross-file resolution"
    ],
    "dependencies": ["D1"],
    "effort": "L"
  },
  {
    "id": "E2",
    "group": "E",
    "priority": "P2",
    "owner": "SymbolsAgent",
    "files": ["crates/virage-engine/src/symbols/resolution.rs", "crates/virage-engine/src/chunkers/lang.rs"],
    "acceptance": [
      "Import statements resolved against global symbol table",
      "ImportResolution metric >= 80% (cross-file)",
      "resolvedImports count includes cross-file resolutions",
      "virage quality run --format json shows ImportResolution mustPassPassed: true"
    ],
    "dependencies": ["E1"],
    "effort": "L"
  },
  {
    "id": "F1",
    "group": "F",
    "priority": "P2",
    "owner": "WASMAgent",
    "files": ["crates/virage-chunker-sdk (new crate)", "docs/wasm-chunker-sdk.md (new)"],
    "acceptance": [
      "Template crate compiles to WASM component",
      "Implements chunker WIT world",
      "Documentation: quickstart, API reference, publishing guide"
    ],
    "dependencies": ["E2"],
    "effort": "M"
  },
  {
    "id": "F2",
    "group": "F",
    "priority": "P2",
    "owner": "WASMAgent",
    "files": ["wit/worlds/source.wit (new)", "wit/worlds/embedder.wit (new)", "wit/worlds/reranker.wit (existing)"],
    "acceptance": [
      "source.wit: SourceProvider interface (listAll, readContent)",
      "embedder.wit: Embedder interface (embedBatch, dimensions)",
      "WIT worlds versioned, documented",
      "wasmtime component model compatible"
    ],
    "dependencies": ["F1"],
    "effort": "M"
  }
]
```