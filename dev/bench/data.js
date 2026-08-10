window.BENCHMARK_DATA = {
  "lastUpdate": 1786337117484,
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
          "id": "4a4e531821e29b96954c1853af245f3a1ce0a8fc",
          "message": "refactor(engine): extract CLI command implementations into virage_engine::cli\n\nMoves the ~30 cmd_* command handlers and their clap Args structs out of\nbin/virage.rs into a new cli-binary-feature-gated virage_engine::cli module\ntree (IR-039 Step 5), so a downstream binary embedding this crate (EE's\nsuperset binary, Step 6) can drive the same command implementations instead\nof duplicating them. bin/virage.rs keeps only the Cli/Commands clap enum and\nmain()'s dispatch, now calling into cli::cmd_*.\n\nPer IR-039's council resolution (delegation, not reimplementation, see\nrust-engineer's card): the extracted surface is feature-gated behind\ncli-binary — not the unconditional library root — keeping the CLI-callers\nanyhow::Result carve-out scoped to callers that opt in.\n\nQ-LEVEL: Q2 — CI run https://github.com/vivantel/virage/actions/runs/30709494487\n(workspace) and PR run https://github.com/vivantel/virage/actions/runs/30709884765\n(both full ci.yaml including Rust lint + Coverage/cargo test, all green)\nCOUNCIL: IR-039 (Accepted) — rust-engineer's card\nEE LEAKAGE CHECK: none — grepped diff and new cli/ tree for EE crate names/concepts, zero hits (one stale doc-comment reference to virage-ee's docs was removed, not carried over)\nNOTE: \"Pipeline Quality Gate\" (eval-gate.yaml) failed on this PR but is the\nsame pre-existing chronic failure documented on PRs #324/#325 — unrelated to\nthis change, not a required check.",
          "timestamp": "2026-08-01T17:19:19Z",
          "url": "https://github.com/vivantel/virage/commit/4a4e531821e29b96954c1853af245f3a1ce0a8fc"
        },
        "date": 1785738715546,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.5019570917774945,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.641314214353768,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6223247155110639,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.7599006384321203,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.62,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.518021978021978,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.39,
            "unit": "score"
          },
          {
            "name": "BreadcrumbConsistency",
            "value": 0.9230769230769231,
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
            "value": 0.9669204304018708,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9722263134171143,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9616145473866273,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.6572045430447964,
            "unit": "score"
          },
          {
            "name": "SelfRecall@K",
            "value": 0.73,
            "unit": "score"
          },
          {
            "name": "IntrinsicDimension",
            "value": 0.1860119047619048,
            "unit": "score"
          },
          {
            "name": "Uniformity",
            "value": 0.8708083600786043,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.050018529901333694,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 1,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.9318387939385308,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.9318387939385308,
            "unit": "score"
          },
          {
            "name": "Lexical Retrieval",
            "value": 0.73,
            "unit": "score"
          },
          {
            "name": "LexicalRecall@K",
            "value": 0.73,
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
          "id": "b05808f7bc87d8c51e8f4dcbe231d1516ebfbe7c",
          "message": "fix(ci): copy tsconfig.base.json + README.md into the ce-subtree export\n\nThe ce-subtree export step only ever copied an explicit per-package/crate\nlist, never repo-root files — tsconfig.base.json (which every exported\npackage's tsconfig.json extends via ../../tsconfig.base.json) and\nREADME.md silently never existed on ce-subtree at all. Surfaced when\nvirage-ee ran a fresh npm run sync:ce: the subtree pull correctly detected\ntsconfig.base.json as \"deleted upstream\" (never present in any ce-subtree\ncommit) and removed EE's own copy, breaking every ce/ package's\nTypeScript build.\n\nQ-LEVEL: Q2 — workflow_dispatch CI run 31195552319 (green) and CE Subtree\nExport run 31195532482 (green, confirmed tsconfig.base.json + README.md\nnow present on the resulting ce-subtree branch via direct API check)\nCOUNCIL: none",
          "timestamp": "2026-08-07T16:03:57Z",
          "url": "https://github.com/vivantel/virage/commit/b05808f7bc87d8c51e8f4dcbe231d1516ebfbe7c"
        },
        "date": 1786337115794,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "Overall Quality",
            "value": 0.5393421121704323,
            "unit": "score"
          },
          {
            "name": "Chunking",
            "value": 0.693943797680363,
            "unit": "score"
          },
          {
            "name": "Cohesion",
            "value": 0.6277798172342588,
            "unit": "score"
          },
          {
            "name": "Coherence",
            "value": 0.7464873148255063,
            "unit": "score"
          },
          {
            "name": "Coverage",
            "value": 0.8,
            "unit": "score"
          },
          {
            "name": "Metadata Extraction",
            "value": 0.5414141414141415,
            "unit": "score"
          },
          {
            "name": "Completeness",
            "value": 0.4,
            "unit": "score"
          },
          {
            "name": "BreadcrumbConsistency",
            "value": 0.9949494949494949,
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
            "value": 0.9617371205111052,
            "unit": "score"
          },
          {
            "name": "TextPurity",
            "value": 0.9847146357634355,
            "unit": "score"
          },
          {
            "name": "EnrichmentQuality",
            "value": 0.9387596052587747,
            "unit": "score"
          },
          {
            "name": "Dense Embedding",
            "value": 0.7060559487422545,
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
            "value": 0.44994863251290207,
            "unit": "score"
          },
          {
            "name": "Isotropy",
            "value": 0.09192530671874227,
            "unit": "score"
          },
          {
            "name": "OutlierFraction",
            "value": 0.99,
            "unit": "score"
          },
          {
            "name": "Sparse Input Prep",
            "value": 0.9466858809933586,
            "unit": "score"
          },
          {
            "name": "TermCoverage",
            "value": 0.9466858809933586,
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