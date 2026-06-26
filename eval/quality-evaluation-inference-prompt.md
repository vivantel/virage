You are an expert in RAG (Retrieval-Augmented Generation) evaluation dataset construction. Your task is to extend or sanitize `eval/quality-evaluation.json` for the **virage** project — a TypeScript monorepo that indexes its own codebase into a vector store and retrieves relevant chunks to answer developer queries.

---

## Codebase overview

**What gets indexed:** TypeScript source files (`packages/*/src/**/*.ts`), Markdown docs (`docs/**/*.md`, `packages/*/README.md`), JavaScript files — all chunked and embedded into a LanceDB vector store. Tests (`**/*.test.ts`), declaration files (`**/*.d.ts`), and compiled output (`**/dist/**`) are excluded.

**Chunking strategy (ADR-038):**
- `.md` / `.mdx` → `@vivantel/virage-chunker-ce-md` (one chunk per heading section)
- `.ts` / `.tsx` / `.js` → `@vivantel/virage-code-chunk-chunker` (one chunk per top-level function/class/block, with scope context)

**Key source directories to mine for anchors:**
```
packages/virage-core/src/          — pipeline classes, eval, interfaces, strategies, utils
packages/virage-core/src/eval/     — EvalRunner, metrics, suite-runner, adaptive-tuner, stats
packages/virage-store-*/src/       — vector store implementations (LanceDB, Postgres, Qdrant)
packages/virage-embedder-*/src/    — embedder implementations (Transformers.js)
packages/virage-reranker-*/src/    — reranker implementations (cross-encoder)
packages/virage-agent-*/src/       — agent plugin implementations (claude, copilot, codex)
packages/virage-cli/src/           — CLI commands and logger
packages/virage-mcp/src/           — MCP server handlers
packages/virage-dashboard/src/     — React dashboard, WebSocket types
docs/decisions/                    — 38 Architecture Decision Records (ADR-001 … ADR-038)
docs/ai/INDEX.md                   — Development guidance and guardrails
```

---

## Output format

Each entry in `eval/quality-evaluation.json` follows this schema:

```json
{
  "query": "natural language developer question",
  "expectedContent": ["UniqueAnchorString"]
}
```

Or, for queries that span multiple related concepts:

```json
{
  "query": "natural language developer question",
  "expectedContent": ["PrimaryAnchor", "SecondaryAnchor"]
}
```

- **`query`**: A complete natural-language sentence or question a developer would actually type (not a keyword list). See style rules below.
- **`expectedContent`**: Array of 1–3 strings. Each string must appear as a substring in the content of a highly relevant chunk for that query. Use 2–3 anchors only when the concept genuinely requires multiple pieces of evidence (e.g., a feature that spans an interface + its implementation, or an ADR that introduces multiple new identifiers).

---

## Quality rules

### Query style

**Queries must read as natural developer questions, not keyword bags.**

| ✗ Keyword bag (reject) | ✓ Natural language (accept) |
|---|---|
| `"embedding layer incremental skip content hash"` | `"How does virage avoid re-embedding a file that hasn't changed?"` |
| `"FTS full-text search BM25 createIndex lancedb"` | `"What needs to happen to enable hybrid BM25 + vector search in LanceDB?"` |
| `"cross-encoder reranker sigmoid logit ms-marco"` | `"How does the cross-encoder reranker score and filter retrieved chunks?"` |
| `"virage config schema embedder dimensions vector store"` | `"What fields are required in a virage config to specify the embedding model?"` |
| `"eval runner MRR precision recall hitrate"` | `"What retrieval metrics does the eval runner compute per query?"` |

Queries should be 7–14 words. They may be phrased as a question (`"How does X work?"`) or as a search statement (`"Steps to configure a custom chunker plugin"`). Either style is fine as long as it is natural English, not symbol soup.

### Anchor rules

1. **Anchor uniqueness:** The anchor must appear in ≤ 8 non-test source files. Verify with:
   ```bash
   grep -r "AnchorString" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\." | wc -l
   ```
   If count > 8, find a more specific anchor (a method name, options interface, unique field) or choose a different query concept.

2. **No duplicates:** Each anchor must appear exactly once across all queries in the dataset. Check `expectedContent` values in the existing dataset before proposing new ones.

3. **Anchor reachability:** The anchor must be in the chunk content that a semantic search for that query would rank in top-10. Anchors in the defining source file are best; anchors that only appear in import lines or test mocks are weak.

4. **Multi-anchor queries:** Use 2–3 anchors when:
   - The concept spans an interface definition and a key implementation (e.g., `EmbeddingProvider` + `embed`)
   - An ADR introduces multiple important identifiers
   - The query asks about a relationship between two things (e.g., "How does X use Y?")
   
   All anchors must pass the uniqueness check independently. The query scores as a hit if ANY anchor appears in the top-K results (OR semantics).

5. **Coverage diversity:** Prefer anchors from areas not yet covered. The current dataset covers eval metrics, hybrid search, reranking, ADR-001/002/003/005/006/008/009/010/011/012/015/016/017/021/022/025/028/033/034, markdown chunking, LanceDB FTS, pipeline classes, RAGAS, agent hooks, MCP, dashboard, config, errors, utilities.

---

## Extend mode (generating new queries)

**Step 1 — Identify uncovered areas.**
List concepts not yet in the dataset by scanning:
- Exported names in `packages/*/src/index.ts` files
- ADR IDs in `docs/decisions/index.md` — check which decision areas are missing
- Interface names in `packages/virage-core/src/interfaces/`

**Step 2 — For each candidate anchor, verify file count.**
```bash
grep -r "CandidateAnchor" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\." | wc -l
```
Only proceed if count ≤ 8.

**Step 3 — Draft the query as natural language.**
Write a question or search statement a developer would use when looking for the concept that anchor represents. The query must NOT contain the anchor string itself. Aim for 7–14 words.

**Step 4 — Output JSON.**
```json
[
  { "query": "How does virage detect when the embedding model has changed?", "expectedContent": ["EmbeddingsMeta"] },
  { "query": "Which git metadata does virage track per file for change detection?", "expectedContent": ["commitHash", "ADR-004"] }
]
```

---

## Sanitize mode (auditing existing queries)

**For each existing query:**

1. **Anchor grep check** — verify the anchor still exists:
   ```bash
   grep -r "AnchorString" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\."
   ```
   If 0 results: the anchor was deleted or renamed. Remove the query or update the anchor.

2. **Style check** — re-read the query text. If it reads as a keyword bag rather than a natural-language question, rewrite it. Example: `"embedding layer incremental skip content hash"` → `"How does virage avoid re-embedding files that haven't changed?"`.

3. **Uniqueness check** — confirm no two queries share the same anchor string.

4. **Query sanity** — does the query still describe the concept? If the codebase was refactored (e.g., ADR superseded, function renamed), update the query text.

5. **Anchor strength** — if the anchor now appears in > 8 files (possibly due to code growth), find a more specific sub-anchor or update the query to target a more distinctive identifier.

Output a JSON array of only the **modified or removed** entries:
```json
[
  { "query": "How does virage avoid re-embedding unchanged files?", "expectedContent": ["ADR-005"], "_change": "rewrote keyword-bag query as natural language" },
  { "_remove": true, "_query": "old query text", "_reason": "anchor no longer exists" }
]
```

---

## Worked examples

**Example 1 — ADR with natural language query**
```bash
grep -r "ADR-007" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\."
# → docs/decisions/ADR-007-tsx-typescript-config-loading.md  (1 file)
```
Query: `"Why was TypeScript config loading removed in favour of JSON-only?"`
Anchor: `ADR-007`
Rationale: Targets the decision context, not just the identifier. Reads as a real developer question.

**Example 2 — Interface method**
```bash
grep -r "embedStream" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\."
# → 2 files
```
Query: `"How does the streaming embedder interface return chunks asynchronously?"`
Anchor: `embedStream`

**Example 3 — Multi-anchor: concept spans interface + implementation**
```bash
grep -r "TokenStrategyOptions" ... # → 3 files
grep -r "slidingWindow" ...        # → 2 files
```
Query: `"How does token-based chunking control window size and overlap?"`
Anchors: `["TokenStrategyOptions", "slidingWindow"]`
Rationale: The feature is defined by both the options type and the sliding-window algorithm; a retrieval result containing either confirms the correct area was found.

**Example 4 — Multi-anchor: ADR + implementing identifier**
```bash
grep -r "ADR-037" ...                    # → 1 file (the ADR doc)
grep -r "sparseTextGeneratorId" ...      # → 3 files (implementation)
```
Query: `"How does virage decide which chunks need re-embedding when chunker config changes?"`
Anchors: `["ADR-037", "sparseTextGeneratorId"]`
Rationale: The decision record explains the why; the field name is the concrete implementation anchor.

**Example 5 — Dashboard type**
```bash
grep -r "WsMessage" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\."
# → 1 file
```
Query: `"What is the WebSocket message format for real-time dashboard updates?"`
Anchor: `WsMessage`

---

## ADRs not yet covered (as of 100 queries)

The following ADRs have no query in the current dataset:

| ADR | Title | Good anchor candidates |
|-----|-------|------------------------|
| ADR-004 | Git commit hash change detection | `blobSha`, `ADR-004` |
| ADR-007 | tsx TypeScript config loading (superseded) | `ADR-007` |
| ADR-013 | Plugin discovery via npm exports | `discoverPlugins`, `ragPlugin` |
| ADR-014 | Standalone CI workflow | `ADR-014`, `virage-runner` |
| ADR-018 | Vitest acceptance test suite | `ADR-018`, `acceptance` |
| ADR-019 | virage-store-test private package | `ADR-019`, `virage-store-test` |
| ADR-020 | virage index subcommand | `ADR-020` |
| ADR-023 | Fail-fast vector store errors | `isFatalVectorStoreError` |
| ADR-024 | Split virage-core / CLI / dashboard | `ADR-024` |
| ADR-026 | Static-file copier agent plugins | `BaseAgentPlugin`, `ADR-026` |
| ADR-027 | list_skills SkillMeta response | `SkillMeta`, `estimated_tokens` |
| ADR-029 | No native subagents for skills | `ADR-029` |
| ADR-030 | Semver ranges in peerDependencies | `ADR-030`, `peerDependencies` |
| ADR-031 | Chunking config exclude patterns | `DEFAULT_EXCLUDE_PATTERNS` |
| ADR-032 | Scanning/chunking performance | `withConcurrency`, `ADR-032` |
| ADR-035 | JSON-only config | `ConfigError`, `ADR-035` |
| ADR-036 | ArtifactSet structure caching | `parentId`, `siblingIds`, `ADR-036` |
| ADR-037 | Per-chunk generator IDs | `sparseTextGeneratorId`, `metadataGeneratorId` |
| ADR-038 | Package-based chunker config | `ADR-038`, `pluginVersions` |

## Other concepts not yet covered

- `embedStream` — streaming embedder interface method
- `runAdaptiveTuning` — query-time parameter grid search (hybridAlpha, topK, rerankOversample)
- `buildInstallCommand`, `detectPackageManager` — package manager detection
- `TelemetryFlusher`, `TelemetryManager` — telemetry lifecycle
- `VectorStoreMeta` — store metadata versioning / schema migration
- `ChunkTransformer` — post-processing pipeline
- `EvalRunResult` — inner eval result type
- `contextRecall`, `answerRelevance` — RAGAS metrics
- `writeEmbeddingsFile` — SQLite embeddings write path
- Docs sections: `docs/ai/INDEX.md` guardrails, `docs/decisions/` individual ADRs
