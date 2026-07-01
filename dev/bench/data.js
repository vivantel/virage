window.BENCHMARK_DATA = {
  "lastUpdate": 1782889450325,
  "repoUrl": "https://github.com/vivantel/virage",
  "entries": {
    "Virage Quality Metrics": [
      {
        "commit": {
          "author": {
            "name": "Sergey Strebulaev",
            "username": "sergemso",
            "email": "strebulaev@gmail.com"
          },
          "committer": {
            "name": "Sergey Strebulaev",
            "username": "sergemso",
            "email": "strebulaev@gmail.com"
          },
          "id": "a000080f46ed16081ad0f61ab985138a1a07e165",
          "message": "fix(ci): restore virage-runner before gh-pages branch switch in quality workflow\n\nbenchmark-action/github-action-benchmark runs git switch gh-pages, which\nfails when npm install has modified the tracked virage-runner/package.json.\nRestore the file first so the branch switch can proceed.",
          "timestamp": "2026-07-01T07:00:03Z",
          "url": "https://github.com/vivantel/virage/commit/a000080f46ed16081ad0f61ab985138a1a07e165"
        },
        "date": 1782889448860,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.6213,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.5694,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6414,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 1,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.21,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.3587,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.2485,
            "unit": "score"
          },
          {
            "name": "BreadcrumbConsistency",
            "value": 0.5068,
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
            "value": 0.9567,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9936,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9199,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.7275,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 0.865,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.1972,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.9189,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.0755,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 0.98,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.8712,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.8712,
            "unit": "score"
          },
          {
            "name": "Lexical Retrieval",
            "value": 0.442,
            "unit": "score"
          },
          {
            "name": "LexicalRecall@K",
            "value": 0.442,
            "unit": "score"
          }
        ]
      }
    ]
  }
}