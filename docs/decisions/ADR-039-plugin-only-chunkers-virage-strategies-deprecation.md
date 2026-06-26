---
id: ADR-039
title: Plugin-only chunkers and virage-strategies deprecation
status: Accepted
date: 2026-06-26
supersedes: ADR-006
related: [ADR-031, ADR-038]
---

## Context

virage originally shipped built-in chunking strategies as part of `@vivantel/virage-strategies`:
`markdownHeaders`, `codeChunkAst`, `token`, `semantic`, `wholeFile`. ADR-006 formalised the
`ChunkStrategy` + `FileChunker` + `createChunker` factory pattern and ADR-038 replaced strategy
names with npm package references in config (`strategy` → `package`).

The built-in strategies are now served by external packages (`@vivantel/virage-chunker-ce-md`,
`@vivantel/virage-code-chunk-chunker`, …). Keeping `virage-strategies` as a published package
creates a maintenance split: the same functionality exists in two places, tests are duplicated,
and users on older configs get confusing errors when built-in names are not found.

The internal chunk data model also evolved. An early design stored a single `content` field.
A second iteration added a `contextText` derived field assembled from surrounding chunks.
Storing assembled context prevents on-the-fly assembly from updated neighbours and bloats the
index. The canonical model is now three fields only.

## Decision

**Three-field flat chunk model.** The canonical chunk stored in the vector database contains
exactly three text fields:

- `denseText` — the content used for embedding (the chunk itself)
- `sparseText` — the content used for BM25 / FTS indexing (may differ from denseText)
- `denseTextHash` — SHA-256 of `denseText`; used for change-detection deduplication (ADR-005)

`contextText` is not stored. Context assembly (parent/sibling text injection) happens at
query time using `metadata.parentId` / `metadata.siblingIds` (ADR-036).

**Plugin-only chunkers.** All chunking is done by external npm packages. There are no
built-in strategy names. A chunker entry in `virage.config.json` must use the `package` key
(ADR-038). Aliases such as `markdownHeaders`, `token`, `semantic`, and `wholeFile` are
considered legacy and will not be extended.

**`virage-strategies` deprecated.** `@vivantel/virage-strategies` will receive no new
publishes. Existing functionality is available via:

| Old alias        | Replacement package                         |
|------------------|---------------------------------------------|
| `markdownHeaders` | `@vivantel/virage-chunker-ce-md`           |
| `codeChunkAst`   | `@vivantel/virage-code-chunk-chunker`       |
| `token`          | _(no direct replacement; use `@vivantel/virage-code-chunk-chunker` with max-token options)_ |
| `semantic`       | _(no direct replacement)_                   |
| `wholeFile`      | _(no direct replacement)_                   |

The config normaliser (`normalizeConfig()`) retains backward-compat handling for the old
`strategy` field so existing configs do not break immediately, but the behaviour is undocumented
and will be removed in a future major release.

## Consequences

- **+** Single source of truth for chunking logic — external packages only.
- **+** `virage-strategies` maintenance burden eliminated.
- **+** Chunk schema is minimal and stable; no derived fields that can go stale.
- **+** README "Built-in strategies" section removed; docs align with implementation.
- **−** `token`, `semantic`, `wholeFile` users must migrate to an external package or keep
  using the deprecated backward-compat path.
- **−** `virage init` generates `{ package, include }` format only for strategies that already
  have a replacement package; the three legacy aliases are emitted in legacy format until
  replacement packages exist.

## Alternatives Considered

**Keep virage-strategies as a thin wrapper.** Rejected — adds a dependency hop with no benefit;
the implementations have already been extracted.

**Migrate `token`/`semantic`/`wholeFile` immediately.** Deferred — replacement packages do not
yet exist; forcing users to a non-existent package would be worse than a deprecation warning.

## References

- [ADR-006](./ADR-006-strategy-pattern-chunking.md) — superseded by this decision
- [ADR-031](./ADR-031-chunking-config-exclude-patterns.md) — `chunking` config section
- [ADR-036](./ADR-036-artifactset-structure-caching.md) — contextText removed, query-time assembly
- [ADR-038](./ADR-038-package-based-chunker-config.md) — `package` replaces `strategy` in config
