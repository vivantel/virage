window.BENCHMARK_DATA = {
  "lastUpdate": 1794222873092,
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
        "date": 1792399331819,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.7225441517326366,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.6802608882561271,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6343672483857703,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.6443572242498082,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.79,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.541340206185567,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.405,
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
            "value": 0.965218765014254,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9809536589435608,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9494838710849471,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.6986013453215718,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 0.98,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.19345238095238096,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.3637513293769838,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.10741006852170502,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 0.99,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.943924782926141,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.943924782926141,
            "unit": "score"
          },
          {
            "name": "Lexical Retrieval",
            "value": 0.98,
            "unit": "score"
          },
          {
            "name": "LexicalRecall@K",
            "value": 0.98,
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
        "date": 1793004311936,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.7263896122101299,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.6950682552720406,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6378755593710255,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.7539755494201823,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.78,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.5406259204712813,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.4025,
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
            "value": 0.960144479273908,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9746306260722305,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9456583324755854,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.700168518355648,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 0.98,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.19345238095238096,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.36647910313570176,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.10232777044725767,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 1,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.9468668590275158,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.9468668590275158,
            "unit": "score"
          },
          {
            "name": "Lexical Retrieval",
            "value": 0.98,
            "unit": "score"
          },
          {
            "name": "LexicalRecall@K",
            "value": 0.98,
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
        "date": 1793616644843,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.7254407238555601,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.7066940530005954,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6418269111119865,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.7195507265562218,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.83,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.5388856161021109,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.405,
            "unit": "score"
          },
          {
            "name": "BreadcrumbConsistency",
            "value": 0.9810996563573884,
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
            "value": 0.956454593191774,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9763278821788615,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9365813042046864,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.6939617779780364,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 0.96,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.19345238095238096,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.40540120710366095,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.10379593760238971,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 0.98,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.9476748371273248,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.9476748371273248,
            "unit": "score"
          },
          {
            "name": "Lexical Retrieval",
            "value": 0.96,
            "unit": "score"
          },
          {
            "name": "LexicalRecall@K",
            "value": 0.96,
            "unit": "score"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "name": "github-actions[bot]",
            "username": "github-actions[bot]",
            "email": "github-actions[bot]@users.noreply.github.com"
          },
          "committer": {
            "name": "github-actions[bot]",
            "username": "github-actions[bot]",
            "email": "github-actions[bot]@users.noreply.github.com"
          },
          "id": "a7288b2bbee875258abd5df7f7aaf3147aaeabc0",
          "message": "chore(release): bump @vivantel/virage-plugin-lancedb to 0.1.1",
          "timestamp": "2026-11-08T23:53:36Z",
          "url": "https://github.com/vivantel/virage/commit/a7288b2bbee875258abd5df7f7aaf3147aaeabc0"
        },
        "date": 1794222871975,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.7416073066386417,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.724327179673292,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6299917003849296,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.8303234561733255,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.86,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.5420544918998528,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.4075,
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
            "value": 0.9634375163274307,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9812492123760269,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9456258202788344,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.7226629261537022,
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
            "value": 0.47743272359321487,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.10540735471645996,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 1,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.9415522255496185,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.9415522255496185,
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