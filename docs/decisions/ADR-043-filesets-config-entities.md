---
id: ADR-043
title: FileSets as first-class config entities
status: Accepted
date: 2026-07-03
supersedes: [ADR-031, ADR-039]
related: [ADR-041, ADR-044, ADR-046]
---

## Context

The `chunking.chunkers[]` array conflated file routing (which files get processed), tag injection (what metadata labels to assign), and plugin selection (which chunker runs). Problems:

1. No way to run multiple chunkers on the same file simultaneously — only first-match-wins.
2. Tag rules (`labels`) were per-chunker, making it hard to assign tags to a file regardless of which chunker produced its chunks.
3. `chunking.ignore` was global-only; per-group ignores were crammed into chunker options.
4. The `chunking.filter.labels` block was a parallel rule system alongside per-chunker `labels`.

## Decision

Replace `chunking` with a `fileSets` array. Each fileSet is a named group of files with an explicit scope, tag injection rules, and multiple chunkers:

```typescript
interface FileSetConfig {
  name: string;
  source?: PluginRef;           // per-fileSet source provider override
  include?: string[];           // file inclusion globs
  ignore?: string[];            // per-fileSet exclusion globs
  tags?: string[];              // injected into ChunkMeta.tags for ALL files in the set
  tagRules?: TagRule[];         // glob-based tag injection within the fileSet
  chunkers: ChunkerConfig[];    // one or more chunkers; ALL run on every matching file
}
```

A top-level `ignore: string[]` provides the global ignore patterns (replaces `chunking.ignore`).

**Multi-chunker per fileSet**: All chunkers in `fileSet.chunkers` run on every file matched by that fileSet. Chunks from each chunker carry a `chunkerKey` (the package name) to distinguish their origin (see ADR-044).

**No first-match-wins**: A file can produce chunks from multiple chunkers in the same run.

**Tag levels**:
- `fileSet.tags` — applied to all chunks from all files in the set, verbatim.
- `fileSet.tagRules` — applied per-file based on minimatch glob matching within the set.

**Breaking change.** Supersedes `chunking.chunkers` (ADR-031 chunking.ignore, ADR-039 plugin-only chunkers).

## Consequences

- **+** Explicit, named file scopes make configuration self-documenting.
- **+** Multiple chunkers per fileSet enables simultaneous knowledge-graph + AST chunking.
- **+** Tags are fileSet-level — consistent regardless of which chunker runs.
- **+** Per-fileSet source override enables EE multi-source indexing.
- **−** More verbose than a flat chunkers array — requires named fileSets even for simple configs.
- **−** Breaking change: no migration path from `chunking.chunkers`.

## Alternatives Considered

**Keep `chunking` array, add multi-chunker flag:** Would not cleanly solve the tag-per-file-group problem. Rejected.

**Named filesets with roles for RBAC:** Considered adding `roles: string[]` to generate `"role:X"` labels. Rejected — ROADMAP's RBAC model uses store-level tag filtering (Phase 5 EE), and claim-to-label mapping handles the JWT→tag translation. Tags are sufficient.

## Guardrail

See `docs/ai/guardrails/config-schema.md` for rules on how agents should evolve the fileSets schema.

## References

- ADR-031 — `chunking` config section with ignore patterns (now superseded)
- ADR-039 — plugin-only chunkers (now superseded)
- ADR-044 — `chunkerKey` in `ChunkMeta`
- ADR-046 — tags as the unified metadata vocabulary
