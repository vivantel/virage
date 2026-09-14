window.BENCHMARK_DATA = {
  "lastUpdate": 1789375619814,
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
      },
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
        "date": 1788168942957,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.7387953112521626,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.694473333823714,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.632843220645372,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.74994045418451,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.79,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.5434830633284242,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.4125,
            "unit": "score"
          },
          {
            "name": "BreadcrumbConsistency",
            "value": 0.9896907216494846,
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
            "value": 0.960696776692292,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9807311572998748,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9406623960847094,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.7333322799146692,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 1,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.19717261904761907,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.5442907366634583,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.11039292746854469,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 0.97,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.9538457987221501,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.9538457987221501,
            "unit": "score"
          },
          {
            "name": "Lexical Retrieval",
            "value": 1,
            "unit": "score"
          },
          {
            "name": "LexicalRecall@K",
            "value": 1,
            "unit": "score"
          }
        ]
      },
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
          "id": "5338f33509b270ba4d2c3ebbd900a50cf288c89b",
          "message": "Merge pull request #411 from vivantel/release-please--branches--master\n\nchore: release master",
          "timestamp": "2026-09-07T05:54:48Z",
          "url": "https://github.com/vivantel/virage/commit/5338f33509b270ba4d2c3ebbd900a50cf288c89b"
        },
        "date": 1788768587318,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.7231777961477573,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.6942696540158967,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6366249125562908,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.7733879278861134,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.77,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.5386111111111112,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.4025,
            "unit": "score"
          },
          {
            "name": "BreadcrumbConsistency",
            "value": 0.982638888888889,
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
            "value": 0.9575881101747672,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9829380840217717,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9322381363277628,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.6936279257066419,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 0.97,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.19717261904761907,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.3736214826314618,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.09557483082818269,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 0.98,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.9515545217644297,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.9515545217644297,
            "unit": "score"
          },
          {
            "name": "Lexical Retrieval",
            "value": 0.9700000000000001,
            "unit": "score"
          },
          {
            "name": "LexicalRecall@K",
            "value": 0.97,
            "unit": "score"
          }
        ]
      },
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
          "id": "f6b99872cefb2334fb717c6bad5c488a6e07c357",
          "message": "docs(cli): note citation/lineStart fields need --force to backfill existing indexes\n\nIR-048 Phase 1.5.\n\nQ-LEVEL: Q0 — CI run 34151713636\nCOUNCIL: none\nEE LEAKAGE CHECK: none",
          "timestamp": "2026-09-07T18:59:44Z",
          "url": "https://github.com/vivantel/virage/commit/f6b99872cefb2334fb717c6bad5c488a6e07c357"
        },
        "date": 1789375618778,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.7184514918881495,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.6958019238997374,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.637354245754373,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.7411964842806696,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.79,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.5394207167403043,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.4,
            "unit": "score"
          },
          {
            "name": "BreadcrumbConsistency",
            "value": 0.9879725085910653,
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
            "value": 0.9545602004456666,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9724421464114308,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9366782544799023,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.6816440976929456,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 0.95,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.19717261904761907,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.3557759708197576,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.09547609027354109,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 0.98,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.9517308219465384,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.9517308219465384,
            "unit": "score"
          },
          {
            "name": "Lexical Retrieval",
            "value": 0.9499999999999998,
            "unit": "score"
          },
          {
            "name": "LexicalRecall@K",
            "value": 0.95,
            "unit": "score"
          }
        ]
      }
    ]
  }
}