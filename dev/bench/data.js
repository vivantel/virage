window.BENCHMARK_DATA = {
  "lastUpdate": 1786938961575,
  "repoUrl": "https://github.com/vivantel/virage",
  "entries": {
    "Virage Quality Metrics": [
      {
        "commit": {
          "author": {
            "name": "S. Strebulaev",
            "username": "sergemso",
            "email": "strebulaev@gmail.com"
          },
          "committer": {
            "name": "GitHub",
            "username": "web-flow",
            "email": "noreply@github.com"
          },
          "id": "f0431764ea513aead6ac27b2e059a00ec5f6b4d5",
          "message": "fix(plugins): gate plugins module on dylib-plugins OR wasm-host, not wasm-host alone\n\nBug in the dylib-plugin loader relocation (#372): lib.rs's `pub mod plugins;`\nwas gated behind wasm-host only. Enabling dylib-plugins without wasm-host\ncompiled nothing (E0433). Surfaced by the first downstream consumer enabling\ndylib-plugins alone.\n\nFix: #[cfg(any(feature = \"wasm-host\", feature = \"dylib-plugins\"))].\n\nNote: this PR's own CI hit a one-off Eval Gate failure (OutlierFraction\n0.050 vs threshold >0.05 — a borderline/nondeterministic ANN-search miss,\nunrelated to this change: a #[cfg] attribute cannot affect embedding\nquality scores). Re-ran that job alone; passed clean on retry, confirming\nflakiness rather than a real regression.\n\nQ-LEVEL: Q2 — workspace-branch run https://github.com/vivantel/virage/actions/runs/31980481577, PR run https://github.com/vivantel/virage/actions/runs/31981782100 (Rust lint pass; Eval Gate passed on re-run after one flaky miss)\nCOUNCIL: none\nEE LEAKAGE CHECK: none",
          "timestamp": "2026-08-17T00:59:24Z",
          "url": "https://github.com/vivantel/virage/commit/f0431764ea513aead6ac27b2e059a00ec5f6b4d5"
        },
        "date": 1786938959300,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.7334638376951151,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.6949095565193957,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6398066140260553,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.7251404395315482,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.79,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.5418270165208942,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.41,
            "unit": "score"
          },
          {
            "name": "BreadcrumbConsistency",
            "value": 0.9863945578231293,
            "unit": "score"
          },
          {
            "name": "FQNCompleteness",
            "value": 0,
            "unit": "score"
          },
          {
            "name": "SiblingIntegrity",
            "value": 1,
            "unit": "score"
          },
          {
            "name": "Dense Input Prep",
            "value": 0.9670495189858996,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9829656504747678,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9511333874970314,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.7177447475755255,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 0.99,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.19717261904761907,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.48145229913233223,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.11343188212193042,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 0.96,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.9498723186877066,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.9498723186877066,
            "unit": "score"
          },
          {
            "name": "Lexical Retrieval",
            "value": 0.9899999999999999,
            "unit": "score"
          },
          {
            "name": "LexicalRecall@K",
            "value": 0.99,
            "unit": "score"
          }
        ]
      }
    ]
  }
}