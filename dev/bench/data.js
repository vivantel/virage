window.BENCHMARK_DATA = {
  "lastUpdate": 1787543998477,
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
          "id": "aa0954b17c31db42249327cacdc2444fb1a20cce",
          "message": "fix(db): use as_chunks instead of chunks_exact for blob_to_f32_vec (#388)\n\nNew clippy lint (chunks_exact_to_as_chunks, stabilized around rustc\n1.98) started failing CI on master with 'using chunks_exact with a\nconstant chunk size' -- pre-existing code, not related to any specific\nfeature work, just a toolchain-version lint catching up to newly\nstable std API. Applies clippy's own suggested replacement.\n\nEE LEAKAGE CHECK: none",
          "timestamp": "2026-08-21T21:22:41Z",
          "url": "https://github.com/vivantel/virage/commit/aa0954b17c31db42249327cacdc2444fb1a20cce"
        },
        "date": 1787543997051,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.7358822419927563,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.6976532477959063,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6325067755207603,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.7735456324883029,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.79,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.5449708454810496,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.4125,
            "unit": "score"
          },
          {
            "name": "BreadcrumbConsistency",
            "value": 0.9948979591836735,
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
            "value": 0.9630760079055144,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9831343534699815,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9430176623410473,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.7218327341389661,
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
            "value": 0.5078260062015632,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.11382829330819547,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 0.96,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.9526278317251647,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.9526278317251647,
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