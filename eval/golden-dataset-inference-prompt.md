You are an expert in RAG (Retrieval-Augmented Generation) evaluation dataset construction. Your task is to extend or sanitize `eval/golden-dataset.json` for the **virage** project — a TypeScript monorepo that indexes its own codebase into a vector store and retrieves relevant chunks to answer developer queries.

---

## Codebase overview

**What gets indexed:** TypeScript source files (`packages/*/src/**/*.ts`), Markdown docs (`docs/**/*.md`, `packages/*/README.md`), JavaScript files — all chunked and embedded into a LanceDB vector store. Tests (`**/*.test.ts`), declaration files (`**/*.d.ts`), and compiled output (`**/dist/**`) are excluded.

**Chunking strategy:**
- `.md` / `.mdx` → `markdownHeaders` (one chunk per heading section)
- `.ts` / `.tsx` / `.js` → `codeChunkAst` (one chunk per top-level function/class/block, with scope context)

**Key source directories to mine for anchors:**
```
packages/virage-core/src/          — pipeline classes, eval, interfaces, strategies, utils
packages/virage-store-*/src/       — vector store implementations
packages/virage-embedder-*/src/    — embedder implementations
packages/virage-reranker-*/src/    — reranker implementations
packages/virage-agent-*/src/       — agent plugin implementations
packages/virage-cli/src/           — CLI commands and logger
packages/virage-mcp/src/           — MCP server handlers
packages/virage-dashboard/src/     — React dashboard, WebSocket types
docs/ADR.md                        — 34 Architecture Decision Records (## ADR-001 … ADR-034)
docs/ROADMAP.md                    — feature roadmap and evaluation targets
docs/USE_CASES.md                  — end-to-end usage scenarios
```

---

## Output format

Each entry in `eval/golden-dataset.json` follows this schema:

```json
{
  "query": "short natural-language developer question 5-9 words",
  "expectedContent": ["UniqueAnchorString"]
}
```

- **`query`**: Plain text, no quotes, 5–9 words. Reads like a developer search (not a keyword list). Mix technical terms naturally.
- **`expectedContent`**: Array of 1–2 strings. Each string must appear as a substring in the content of the most relevant chunk for that query. Anchors are typically: exported function/class/interface names, ADR identifiers, unique field names, or specific string constants.

When outputting new queries, return a **JSON array** of objects using the schema above. Do not wrap in markdown fences — output raw JSON.

---

## Quality rules

1. **Anchor uniqueness:** The anchor must appear in ≤ 8 non-test source files. Verify with:
   ```bash
   grep -r "AnchorString" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\." | wc -l
   ```
   If count > 8, find a more specific anchor (a method name, options interface, unique field) or choose a different query concept.

2. **No duplicates:** Each anchor must appear exactly once across all queries in the dataset. Check `expectedContent` values in the existing dataset before proposing new ones.

3. **Query naturalness:** The query should read as a real developer question, not a symbol soup. "HNSW index M ef-construction neighbor graph parameters" is fine. "HNSWParams options class interface" is not.

4. **Anchor reachability:** The anchor must be in the chunk content that a semantic search for that query would rank in top-10. Anchors in the defining source file are best; anchors that only appear in import lines or test mocks are weak.

5. **Coverage diversity:** Prefer anchors from areas not yet covered. The current dataset covers: eval metrics, hybrid search, reranking, ADR-004/005, markdown chunking, LanceDB FTS, pipeline classes, RAGAS, agent hooks, MCP, dashboard, config, errors, utilities, and 20 more ADRs.

---

## Extend mode (generating new queries)

Use this procedure to add N new queries:

**Step 1 — Identify uncovered areas.**
List concepts not yet in the dataset by scanning:
- Exported names in `packages/*/src/index.ts` files
- Section headers in `docs/ADR.md` (check which ADR-XXX numbers are missing)
- Interface names in `packages/virage-core/src/interfaces/`
- Strategy option types in `packages/virage-strategies/src/`

**Step 2 — For each candidate anchor, verify file count.**
```bash
grep -r "CandidateAnchor" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\." | wc -l
```
Only proceed if count ≤ 8.

**Step 3 — Draft the query.**
Write a 5–9 word natural query that a developer would type when looking for the concept that anchor represents. The query should NOT contain the anchor string itself.

**Step 4 — Output JSON.**
Return a JSON array:
```json
[
  { "query": "...", "expectedContent": ["AnchorString"] },
  { "query": "...", "expectedContent": ["AnchorString2"] }
]
```

---

## Sanitize mode (auditing existing queries)

Use this procedure to validate and clean the existing dataset:

**For each existing query:**

1. **Anchor grep check** — verify the anchor still exists:
   ```bash
   grep -r "AnchorString" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\."
   ```
   If 0 results: the anchor was deleted or renamed. Remove the query or update the anchor.

2. **Uniqueness check** — confirm no two queries share the same anchor string.

3. **Query sanity** — re-read the query text. Does it still describe the concept? If the codebase was refactored (e.g., ADR superseded, function renamed), update the query text.

4. **Anchor strength** — if the anchor now appears in > 8 files (possibly due to code growth), find a more specific sub-anchor or update the query to target a more distinctive identifier.

Output a JSON array of only the **modified or removed** entries, with a comment field explaining the change:
```json
[
  { "query": "...", "expectedContent": ["NewAnchor"], "_change": "anchor renamed from OldAnchor to NewAnchor" },
  { "_remove": true, "_query": "old query text", "_reason": "anchor no longer exists" }
]
```

---

## Worked examples

**Example 1 — ADR identifier**
```bash
grep -r "ADR-007" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\."
# → docs/ADR.md  (1 file)
```
Query: `"tsx zero-build TypeScript config loading superseded"`
Anchor: `ADR-007`
Rationale: ADR-007 describes the tsx-based config loading approach that was later superseded. The query targets the decision rationale; the anchor is unique to that ADR section.

**Example 2 — Interface method**
```bash
grep -r "embedStream" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\."
# → packages/virage-core/src/interfaces/embedder.ts
#   packages/virage-embedder-transformers/src/embedder.ts  (2 files)
```
Query: `"streaming async generator embedder output interface"`
Anchor: `embedStream`
Rationale: 2 files — the interface definition and one implementation. Very specific to the streaming embedder capability.

**Example 3 — Strategy options type**
```bash
grep -r "TokenStrategyOptions" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\."
# → 3 files
```
Query: `"token-based chunking maxTokens overlap sliding window"`
Anchor: `TokenStrategyOptions`
Rationale: Configuration type unique to the token chunking strategy; query describes the concept without naming the type.

**Example 4 — Unique constant**
```bash
grep -r "BUILTIN_STRATEGY_NAMES" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\."
# → 2 files
```
Query: `"built-in chunking strategy names constant list"`
Anchor: `BUILTIN_STRATEGY_NAMES`
Rationale: Single constant that lists all built-in strategy names. 2 files (definition + export).

**Example 5 — Dashboard type**
```bash
grep -r "WsMessage" packages/*/src/ docs/ --include="*.ts" --include="*.md" -l | grep -v "\.test\."
# → 1 file (packages/virage-dashboard/src/)
```
Query: `"WebSocket message format real-time dashboard data"`
Anchor: `WsMessage`
Rationale: Appears in exactly one file. Very strong signal that the dashboard WebSocket layer was retrieved.

---

## Concepts not yet in the dataset (as of 100 queries)

Potential areas for future expansion:
- `embedStream` (streaming embedder interface method)
- `ADR-007`, `ADR-013`, `ADR-014`, `ADR-018`, `ADR-019`, `ADR-020`, `ADR-023`, `ADR-024`, `ADR-026`, `ADR-027`, `ADR-029`, `ADR-030`, `ADR-031`, `ADR-032` (ADRs not yet covered)
- `SkillManifest`, `SkillManifestEntry` (skill management)
- `buildInstallCommand`, `detectPackageManager` (package manager detection)
- `runReport`, `runDashboard`, `runInit`, `runValidate`, `runCheck` (more CLI commands)
- `TelemetryFlusher`, `TelemetryManager` (telemetry lifecycle)
- `VectorStoreMeta` (store metadata versioning)
- `ChunkTransformer` (post-processing pipeline)
- `EvalRunResult` (inner eval run result type)
- `DatabaseSpec` (already covered) — `EvalSuite` top-level suite type
- `contextRecall`, `answerRelevance` (more RAGAS metrics)
- `writeEmbeddingsFile` (SQLite embeddings write path)
- `EvalSuiteRunOptions` (CLI options for eval suite)
- Docs sections: `ROADMAP.md` evaluation targets, `USE_CASES.md` scenarios
