---
id: ADR-038
title: Package-based chunker configuration (deprecate strategy + patterns)
status: Accepted
date: 2026-06-26
related: [ADR-006, ADR-011, ADR-035]
---

## Context

The chunker configuration format required users to specify:
1. `patterns` — glob patterns for which files the chunker handles.
2. `strategy` — the npm package name (or historically a built-in strategy name).
3. `ignorePatterns` — per-chunker file exclusions.
4. `strategyOptions` — options forwarded to `createChunker()`.

Problems:
- `patterns` duplicates information the chunker package already declares in its `patterns` field. Users had to copy the package's declared patterns into the config and keep them in sync.
- `strategy` was a confusing name that conflated the concept of a "strategy" with an npm package reference.
- `ignorePatterns` was a top-level field parallel to (but semantically part of) the chunker's own options.
- There was no explicit `version` field, making it impossible to know from the config which version of a chunker was used.

## Decision

**Breaking change. No backward compatibility. No migration path.**

Replace the per-chunker config format:

**Before:**
```json
{
  "chunking": {
    "chunkers": [
      {
        "patterns": ["**/*.md", "**/*.mdx"],
        "strategy": "@vivantel/virage-chunker-ce-md",
        "ignorePatterns": ["**/node_modules/**", "CHANGELOG.md"],
        "strategyOptions": { "overlap": 0.15 }
      }
    ]
  }
}
```

**After:**
```json
{
  "chunking": {
    "chunkers": [
      {
        "package": "@vivantel/virage-chunker-ce-md",
        "version": "^0.1.3",
        "options": {
          "ignore": ["**/node_modules/**", "CHANGELOG.md"],
          "overlap": 0.15
        }
      }
    ]
  }
}
```

Changes:
- `strategy` → `package` (required).
- `version` added (optional but recommended for reproducibility and generator ID traceability).
- `patterns` removed — the installed package declares its own patterns.
- `ignorePatterns` removed — moved into `options.ignore` alongside other chunker options.
- `strategyOptions` removed — all options now go directly in `options`.
- `name` removed — chunkers are identified by their package name.

**Deprecation notice:** Users who have an existing `virage.config.json` must manually update each chunker entry to the new format. The `strategy` and `patterns` fields are no longer recognised and will cause a `ConfigError`.

## Consequences

- **+** Decouples chunker file-pattern declarations from the core config — packages can update their patterns independently.
- **+** Explicit `version` enables reproducible indexing and accurate generator ID traceability.
- **+** Simpler config with fewer fields.
- **+** `options` is a single flat object — no split between `ignorePatterns` and `strategyOptions`.
- **−** Breaking change: all existing `virage.config.json` files must be updated manually.
- **−** No automatic migration.

## Alternatives Considered

**Keep `strategy` as an alias for `package`:** Reduces breakage but prolongs the confusing naming. Rejected in favour of a clean break.

**Keep `patterns` as an optional override:** Would allow scoping a chunker to a subset of its declared patterns. Deferred — if needed, can be added as `options.scope` in a future non-breaking change.

## References

- ADR-006 — original strategy pattern decision
- ADR-011 — JSON config format
- ADR-035 — JSON-only config (removal of TypeScript config)
