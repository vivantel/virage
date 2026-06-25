---
id: ADR-031
title: chunking config section with global exclude patterns
status: Accepted
date: 2026-06-20
---

## Context

The root-level `chunkers` array in `virage.config.json` had no mechanism for excluding files globally — every chunker had to embed exclusion logic into its own pattern list, leading to repetition. Common generated, minified, or dependency-managed files (lock files, `dist/`, `vendor/`, compiled artifacts) were indexed unnecessarily, wasting embedding calls and polluting search results.

A related issue: `CliGitSourceRepository` included changed and pending files regardless of whether the file was otherwise configured to be skipped by `GitTracker`.

## Decision

Introduce a `chunking` wrapper object in the config schema that groups:
- `chunkers` — the existing array of chunker definitions (now nested)
- `exclude` — a new optional `string[]` of glob patterns excluded from all chunkers globally

**Backward compatibility**: configs with `chunkers` at the root are promoted to `chunking.chunkers` at load time by `normalizeConfig()` — before JSON Schema validation runs — so no consumer migration is required.

**Default exclude patterns** (written by `virage init`, exported as `DEFAULT_EXCLUDE_PATTERNS` from `virage-core`):
- Node.js: `**/yarn.lock`, `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/.next/**`, `**/.turbo/**`
- .NET: `**/bin/**`, `**/obj/**`, `**/*.generated.cs`, `**/*.pb.cs`
- Java: `**/target/**`, `**/*.class`
- Go: `**/*.pb.go`
- C/C++: `**/CMakeFiles/**`, `**/*.o`, `**/*.a`
- Universal: `**/dist/**`, `**/out/**`, `**/vendor/**`, `**/*.min.js`, `**/*.min.css`, `**/*.lock`, `**/*.pb.ts`

**Filtering is applied at two layers**:
1. `GitTracker.getAllTrackedFiles()` merges `excludePatterns` into glob's `ignore` option for efficient directory pruning.
2. `CliGitSourceRepository.getChangedFilesSince()` and `getPendingChanges()` filter results through `isExcluded()`.

## Consequences

- **+** Single canonical exclude list applies to all chunkers; no per-chunker repetition.
- **+** `virage init` seeds sane defaults per ecosystem.
- **+** Directory-level pruning in glob avoids descending into `vendor/` or `target/`.
- **+** Full backward compatibility: old root-level `chunkers` configs load without changes.
- **−** `normalizeConfig()` must stay in sync if new top-level chunking config fields are added.
- **−** Schema keeps a deprecated optional `chunkers` at root so the schema itself doesn't reject old configs before the runtime normalizer runs.

## Alternatives Considered

[Not documented in original]

## References

[Not documented in original]
