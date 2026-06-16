---
name: architect
description: Make architecture decisions, write ADRs, design new interfaces, and understand existing system design.
license: MIT
when_to_use:
  - "Writing or updating an ADR in docs/ADR.md"
  - "Designing a new interface or cross-package contract"
  - "Planning a refactor that changes module boundaries"
  - "Evaluating architectural trade-offs before implementation"
prerequisites: []
estimated_tokens: 2040
output_format: "ADR appended to docs/ADR.md, or architectural analysis with decision and consequences"
metadata:
  author: vivantel-team
  version: "1.1.0"
---

# Skill: Architecture

**Purpose:** Make architecture decisions, write ADRs, design new interfaces, and understand existing system design.

---

## When to use this skill

- Making or reviewing an architecture decision
- Writing a new ADR in `docs/ADR.md`
- Designing a new provider interface or pipeline stage
- Understanding the existing pipeline structure, module system, or plugin registry

---

## Context checklist

```
[ ] mcp__virage__search("ADR <decision topic>", top_k=3) — loads only the relevant ADRs instead of the full docs/ADR.md file (~12,700 tokens)
[ ] If an ADR hit is ambiguous, Read that specific section of docs/ADR.md only
[ ] mcp__virage__search("<InterfaceName> interface signature", top_k=5) — loads relevant interface definitions instead of reading all files in packages/virage-core/src/interfaces/
[ ] Before committing: npm run fix && npm run lint && npm run type-check:ci (see .agents/skills/code-guardian/SKILL.md)
```

> **Fallback:** if `mcp__virage__search` returns 0 results (index not populated), fall back to `Read docs/ADR.md` and `Read packages/virage-core/src/interfaces/index.ts` directly.

---

## Current State — Architecture facts

| Property                | Value                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Module system           | ESM (`"type": "module"`), NodeNext resolution                                               |
| Import extensions       | `.js` on all internal imports (e.g. `from "./foo.js"` even though file is `.ts`)            |
| TypeScript target       | ES2022                                                                                      |
| Pipeline model          | 4-stage linear: GitTracker → ChunkProcessor → EmbedderProcessor → Uploader                  |
| Default artifact dir    | `.virage/` (override via `VIRAGE_DIR` env var)                                              |
| Config format           | JSON only; `loadConfig()` validates schema, expands `${ENV_VAR}`, dynamic-imports providers |
| Core package constraint | `virage-core` has no CLI dependencies                                                       |

> **Keep these facts current.** After any architectural change, update this table and write an ADR.

---

## Current State — ADR log

| ADR     | Decision                                          |
| ------- | ------------------------------------------------- |
| ADR-001 | ESM-first with NodeNext module resolution                       |
| ADR-002 | Four-stage linear pipeline                                      |
| ADR-003 | Consumer-implemented provider interfaces                        |
| ADR-004 | Git commit hash for change detection                            |
| ADR-005 | Content hash for embedding-layer incremental skip               |
| ADR-026 | Static-file copier model for agent plugins (plugin-config/ dir) |

> **Keep this log current.** After writing a new ADR in `docs/ADR.md`, add a row here.

---

## ADR process

1. Check `docs/ADR.md` — has this trade-off been evaluated?
2. If not: add a new entry to `docs/ADR.md` with format: `## ADR-NNN: Title` → Context → Decision → Consequences
3. Reference the ADR number in the relevant commit message (e.g. `feat: add streaming pipeline [ADR-006]`)
4. Update the §ADR log above

---

## Pipeline stages

1. **GitTracker** (`packages/virage-core/src/core/git-tracker.ts`)
   - Uses `simple-git` + `glob` to find files matching chunker patterns
   - Computes per-file commit hashes; appends `-dirty` when uncommitted changes exist
   - Excludes: `node_modules/`, `dist/`, `build/`, `out/`, `coverage/`, `.git/`, `.next/`, `.turbo/`, `.cache/`

2. **ChunkProcessor** (`packages/virage-core/src/core/`)
   - Runs each file through its matched `FileChunker`
   - Adds `contentHash` (SHA-256 first 16 chars) to each chunk
   - `replaceChunks()` atomically replaces old chunk rows — DB is always consistent

3. **EmbedderProcessor** (`packages/virage-core/src/core/`)
   - `embedChunks(chunks)`: batch embedding with automatic sub-batching by `batchSize` + `maxBatchChars`
   - Triggered when pending-embed queue reaches `minEmbeddingBatchSize` (default 10)

4. **Uploader** (`packages/virage-core/src/core/`)
   - `prepareUpdate()`: deletes stale vector store entries before chunking loop
   - `upsertBatch()`: uploads batch, marks chunks uploaded, clears embedding BLOB to reclaim storage
   - Fatal vector store errors detected by `isFatalVectorStoreError()`
   - Triggered when pending-upload queue reaches `minUploadingBatchSize` (default 20)

**Orchestrator** (`packages/virage-core/src/core/orchestrator.ts`): runs a single streaming interleave loop — chunk → embed → upload as batches accumulate.

**Progress callbacks**: `RAGPipelineConfig.options` accepts `onChunkProgress`, `onEmbedProgress`, `onUploadProgress`. Totals for embed/upload grow dynamically via `setTotal()`.

---

## Provider interfaces (`packages/virage-core/src/interfaces/`)

| Interface           | Key methods                                                               |
| ------------------- | ------------------------------------------------------------------------- |
| `FileChunker`       | `chunk(filePath, commitHash): Promise<Chunk[]>` + `patterns: string[]`    |
| `EmbeddingProvider` | `embed(text): Promise<number[]>`, optional `embedBatch`                   |
| `VectorStore`       | `initialize`, `upsert`, `deleteBySourceFile`, `getCurrentState`, `search` |
| `Logger`            | `debug/info/warn/error(msg)`                                              |

Quality/observability types in `src/interfaces/quality.ts`: `ChunkQualityMetrics`, `EmbeddingMetrics`, `IndexStats`, `QueryPerfReport`, `EvalResult`, `ExperimentRun`.

---

## `createChunker` helper (`packages/virage-core/src/helpers/create-chunker.ts`)

Two usage styles enforced by a TypeScript discriminated union:

```ts
// Strategy shorthand (common case):
createChunker({ patterns: ["docs/**/*.md"], strategy: markdownHeadersStrategy() })

// Custom process (advanced — name is required):
createChunker({ name: "custom", patterns: ["**/*.txt"], process: async (content) => [...] })
```

Built-in strategies (in `src/strategies/chunk/`): `tokenStrategy`, `markdownHeadersStrategy`, `semanticStrategy`, `wholeFileStrategy`.

`ChunkStrategy` has an optional `getQualityMetrics?(chunks): ChunkQualityMetrics` hook.

---

## Plugin registry pattern (`packages/virage-core/src/plugin-registry.ts`)

Packages self-register by adding a `"rag-plugin"` field to their `package.json`:

```json
"rag-plugin": {
  "type": "vectorStore",
  "label": "MyStore",
  "key": "mystore",
  "envVars": ["MY_API_KEY"],
  "defaultConfig": { "apiKey": "${MY_API_KEY}" }
}
```

`loadRegistry(projectRoot)` merges `BUILT_IN_PLUGINS` with externals discovered from `node_modules`. External plugins override built-ins with the same `type:key`. The `package` field is auto-filled from the containing `package.json`'s `name`.

---

## Logger

- `createLogger(verbosity: number): Logger` — factory in `packages/virage-cli/src/logger/`
- `ConsolaLogger`: wraps `consola` for terminal output; verbosity 0 = errors only, 1–5 = progressively more debug
- `NullLogger`: no-op for tests and library use (`packages/virage-core/src/logger/null-logger.ts`)
- All provider packages accept `setLogger(logger: Logger)` so log output propagates through the full pipeline
