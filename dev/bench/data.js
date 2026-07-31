window.BENCHMARK_DATA = {
  "lastUpdate": 1785483894620,
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
          "id": "a7f5503b5e0f6531f344ad8aebf7d7f383301bc8",
          "message": "fix(ci): add missing --config flag, fix sourceFile casing in token-efficiency.mts\n\nRust CLI's quality/eval/bench commands don't default to virage.config.ci.json\nlike index does — need explicit --config. token-efficiency.mts read the old\nJS CLI's snake_case source_file field; Rust query --json emits camelCase\nsourceFile. Also surface execSync errors instead of silently swallowing them.",
          "timestamp": "2026-07-31T07:42:31Z",
          "url": "https://github.com/vivantel/virage/commit/a7f5503b5e0f6531f344ad8aebf7d7f383301bc8"
        },
        "date": 1785483892965,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.5022628845613223,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.629762096501827,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6151227611391419,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.7478436309562216,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.6,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.5157112718505124,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.3725,
            "unit": "score"
          },
          {
            "name": "BreadcrumbConsistency",
            "value": 0.9324894514767933,
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
            "value": 0.9690283719923016,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9741548039911448,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9639019399934585,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.6667092576295125,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 0.74,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.18973214285714288,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.8962584325472082,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.0552391983749613,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 1,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.9330429864097054,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.9330429864097054,
            "unit": "score"
          },
          {
            "name": "Lexical Retrieval",
            "value": 0.7399999999999999,
            "unit": "score"
          },
          {
            "name": "LexicalRecall@K",
            "value": 0.74,
            "unit": "score"
          },
          {
            "name": "Reranker Input",
            "value": 0,
            "unit": "score"
          },
          {
            "name": "Reranker",
            "value": 0,
            "unit": "score"
          }
        ]
      }
    ]
  }
}