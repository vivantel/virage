window.BENCHMARK_DATA = {
  "lastUpdate": 1791801260130,
  "repoUrl": "https://github.com/vivantel/virage",
  "entries": {
    "Virage Quality Metrics": [
      {
        "commit": {
          "author": {
            "name": "S.Strebulaev",
            "username": "sergemso",
            "email": "strebulaev@gmail.com"
          },
          "committer": {
            "name": "S.Strebulaev",
            "username": "sergemso",
            "email": "strebulaev@gmail.com"
          },
          "id": "8ee9613f532988262e3b19885f61207664922f8c",
          "message": "fix(clippy): add must_use reasons to async trait methods in sources and stores\n\nFixes pre-existing clippy::double_must_use warnings on async trait methods\nin SourceProvider and VectorStore traits. Added explicit reasons to the\nmust_use attributes to satisfy clippy::double_must_use lint.\n\nThese were pre-existing issues in the codebase blocking CI.\n\nRefs: .opencode/plans/virage-quality-improvement-plan.md\nRefs: .opencode/plans/task-specs.md",
          "timestamp": "2026-10-04T16:09:05Z",
          "url": "https://github.com/vivantel/virage/commit/8ee9613f532988262e3b19885f61207664922f8c"
        },
        "date": 1791195334444,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.7220965743020324,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.6939167305820421,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6416558509599146,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.6907937102346368,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.8,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.5389698736637513,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.4,
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
            "value": 0.9616786004579287,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9771461077296167,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9462110931862409,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.6910788638513105,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 0.97,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.19345238095238096,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.35461087090347565,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.1078987263553239,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 0.98,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.941866721237474,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.941866721237474,
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
            "name": "S.Strebulaev",
            "username": "sergemso",
            "email": "strebulaev@gmail.com"
          },
          "committer": {
            "name": "S.Strebulaev",
            "username": "sergemso",
            "email": "strebulaev@gmail.com"
          },
          "id": "d2daa60da7d1913caca1909d256a1cfec868fb06",
          "message": "fix: resolve clippy errors in symbol_index and walk\n\n- Use strip_prefix() instead of manual slicing for crate:: and ./ prefixes\n- Remove empty lines after doc comments\n\nRefs: docs/ai/guardrails/virage-db.md\nRefs: docs/decisions/ADR-038-import-resolution.md",
          "timestamp": "2026-10-05T21:43:14Z",
          "url": "https://github.com/vivantel/virage/commit/d2daa60da7d1913caca1909d256a1cfec868fb06"
        },
        "date": 1791801258217,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.7230874861653135,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.6797999826505493,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6413658665239068,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.6931364124582177,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.75,
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
            "value": 0.9826388888888888,
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
            "value": 0.9618692561898078,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9799681074609037,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9437704049187119,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.7064834095193974,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 0.97,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.19345238095238096,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.4342745188960199,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.10883052405536413,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 1,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.941900249147013,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.941900249147013,
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
      }
    ]
  }
}