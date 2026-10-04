# Dogfooding Virage: Developer Workflow

This document describes how to use Virage during Virage development — the "dogfooding" workflow.

## Quick Reference

| Task | Command | When |
|------|---------|------|
| Search codebase | `/rag "question"` (Opencode/Claude) | Any time |
| Full QA gate | `opencode agent run virage-qa` | Before PR / CI |
| Quality check | `virage quality --fail-fast` | Before commit |
| Retrieval eval | `virage eval run ragbench:covidqa --ci` | Config changes |
| Benchmarks | `virage quality bench embedder/chunker/reranker` | Performance tuning |
| Re-index | `virage index` (auto via git hooks) | After pull / branch switch |

---

## Daily Workflow

### Morning: Pull & Sync
```bash
git pull
# Post-merge hook auto-runs: virage index (incremental, ~5s)
```

### During Development: Semantic Search
Instead of `grep -r` or file navigation:
```bash
# In Opencode (with MCP hook) or Claude Code:
/rag "how does the chunker-lang handle generics"
/rag "where is the embedder config validated"
/rag "show me the pipeline concurrency logic"
```

Returns exact code chunks with context — not just filenames.

### Code Review: Full Context
```bash
# In Claude Code:
/review
# Loads code-guard skill + searches relevant callers via MCP
```

### Before Commit: Quality Gate
```bash
virage quality --fail-fast --config virage.config.json
# 26-metric self-assessment, exits 1 if MUST-PASS violated
# Hook runs this automatically on commit (hard gate)
```

### Config Changes: Eval Regression Test
```bash
virage eval run ragbench:covidqa --ci --config virage.config.json
# MRR >= 0.6 gate, exits 4 on failure
# Compare with: virage eval compare --baseline <id> --candidate <id>
```

### Performance Tuning: Benchmarks
```bash
virage quality bench embedder --config virage.config.json
virage quality bench chunker 'crates/**/*.rs' 'packages/**/*.ts' --config virage.config.json
virage quality bench reranker --config virage.config.json
# Tracks p50/p95/p99 latency + throughput
```

---

## Agent Integration

### Opencode (This Repo)
- **MCP**: `virage` server registered → `/rag` works natively
- **Hook**: Auto-injects RAG context on every prompt
- **Agent**: `virage-qa` runs full QA pipeline

```bash
# Run QA agent
opencode agent run virage-qa "Run full QA pipeline"

# Search manually
/rag "question"
```

### Claude Code
Installed via `virage init` → Select "Claude Code"
- Slash commands: `/rag`, `/plan`, `/review`, `/doc`, `/arch`, `/quality`, `/index`, `/usage`
- MCP server: `claude mcp add virage --scope project -- npx -y @vivantel/virage-agent-claude@latest`
- Skills: `.claude/skills/virage-agent/`

### GitHub Copilot
Installed via `virage init` → Select "GitHub Copilot"
- Config: `.github/copilot/hooks.json`, `.github/copilot/instructions/`
- Inline chat uses virage index automatically

### OpenAI Codex
Installed via `virage init` → Select "OpenAI Codex"
- Config: `.codex/hooks.json`

---

## Quality Gates (Hard Requirements)

| Metric | Threshold | Enforcement |
|--------|-----------|-------------|
| Overall Quality Score | ≥ 70% | Commit hook + CI |
| MRR@10 | ≥ 0.6 | `virage eval run --ci` |
| Precision@5 | ≥ 0.7 | `virage eval run --ci` |
| Self-Recall@10 | ≥ 0.95 | Quality check |
| Outlier Fraction | = 0.0 | Quality check |

**Commit hook** (`.git/hooks/post-merge`, `post-checkout`):
- Runs `virage index` (incremental)
- Runs `virage quality --fail-fast` (blocks commit on failure)

**CI** (`.github/workflows/virage-dogfood.yaml`):
- Full test suite + build
- Opencode QA agent
- Index pipeline with caching

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "No index found" | `virage index --force` (full rebuild) |
| Quality score drops | Check chunking (66%→) or metadata extraction (52%→) |
| MRR regression | `virage eval compare --baseline <old> --candidate <new>` |
| Slow queries | Check `virage quality bench embedder` — may need model cache warm |
| Hook fails | `virage install-hooks --config virage.config.json` (reinstall) |

---

## Config Reference

### virage.config.json (This Repo)
```json
{
  "providers": {
    "embedder": { "builtin": "onnx", "options": { "model": "Xenova/all-MiniLM-L6-v2", "dimensions": 384 }},
    "vectorStore": { "builtin": "lancedb", "options": { "uri": ".virage/lancedb" }},
    "reranker": { "builtin": "cross-encoder", "options": { "model": "Xenova/ms-marco-MiniLM-L-6-v2" }}
  },
  "fileSets": [
    { "name": "rust", "include": ["crates/**/*.rs"], "chunkers": [{ "builtin": "lang" }]},
    { "name": "typescript", "include": ["packages/*/src/**/*.ts"], "chunkers": [{ "builtin": "lang" }]},
    { "name": "markdown", "include": ["docs/**/*.md", "**/*.md"], "chunkers": [{ "builtin": "md" }]},
    { "name": "config", "include": ["**/*.json", "**/*.yaml", "**/*.toml"], "chunkers": [{ "builtin": "lang" }]}
  ],
  "search": { "hybrid": true, "hybridAlpha": 0.6 },
  "pipeline": { "batchSize": 20, "concurrency": 8 }
}
```

### File Coverage (Current)
| FileSet | Files | Chunks | Chunker |
|---------|-------|--------|---------|
| rust | 99 | ~200 | lang (AST) |
| typescript | 204 | ~300 | lang (AST) |
| markdown | 162 | ~100 | md (headers) |
| config | 113 | ~50 | lang |

Total: ~600 chunks, 4 chunkers, ONNX embedder, LanceDB store

---

## Updating the Dogfooding Setup

```bash
# Update Virage CLI + agent plugins
virage update

# Regenerate agent configs after update
virage init  # Re-select agents, overwrites configs

# Update eval baseline after intentional quality change
virage eval run ragbench:covidqa --config virage.config.json
# Note new run ID, then use as baseline for future comparisons
```

---

## Architecture Decisions

- **ADR-002**: Four-stage pipeline (GitTracker → ChunkProcessor → EmbedderProcessor → Uploader)
- **ADR-041/043**: V2 config with `providers` + `fileSets`
- **ADR-051**: Rust monolith (virage-engine) with feature flags
- **Local-first**: ONNX embedder + LanceDB = zero API keys, zero external deps
- **Incremental**: Git commit hash + content hash = only changed files re-embedded