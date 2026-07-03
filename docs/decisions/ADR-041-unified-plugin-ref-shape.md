---
id: ADR-041
title: Unified PluginRef shape for all plugin configuration blocks
status: Accepted
date: 2026-07-03
related: [ADR-038, ADR-011, ADR-035]
---

## Context

Plugin configuration blocks in `virage.config.json` used inconsistent field names across plugin types:

- Embedder and vector store used `config: Record<string, unknown>` for plugin-specific options.
- Chunkers used `options: Record<string, unknown>` (introduced in ADR-038).
- Rerankers (inside `search.reranker`) also used `config`.
- Source repositories used `config`.

The version field was tracked via a separate top-level `pluginVersions` map keyed by package name, creating a split where plugin identity and version were in two different places.

## Decision

All plugin blocks now use a single canonical shape:

```typescript
interface PluginRef {
  package: string;           // required: npm package name
  packageVersion?: string;   // optional: semver range (e.g. "^0.2.0")
  options?: Record<string, unknown>;  // optional: plugin-specific options
}
```

- `config` is removed everywhere; use `options` instead.
- `pluginVersions` top-level map is removed. Version is tracked inline via `packageVersion`.
- All plugin blocks — embedder, vectorStore, reranker, source, agents — use `PluginRef`.
- Chunkers extend `PluginRef` with an optional `templates` field.

**Breaking change. No backward compatibility. No migration path.**

```json
{
  "providers": {
    "embedder": {
      "package": "@vivantel/virage-embedder-fastembed",
      "packageVersion": "^0.2.0",
      "options": { "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 }
    },
    "vectorStore": {
      "package": "@vivantel/virage-store-lancedb",
      "options": { "uri": ".virage/lancedb" }
    }
  }
}
```

## Consequences

- **+** Single canonical shape: `{ package, packageVersion?, options? }` for all plugins.
- **+** Version is co-located with the plugin it describes — no hidden indirection.
- **+** `options` is used consistently across all plugin types.
- **−** Breaking change: all existing configs must be manually migrated.

## Alternatives Considered

**Keep `config` on embedder/store, use `options` only on chunkers:** Reduces breakage but maintains the inconsistency. Rejected — inconsistency causes confusion for plugin authors and users.

**Keep `pluginVersions` as supplemental:** Allows pinning without editing each block. Rejected — redundancy between inline and top-level versions creates drift.

## References

- ADR-038 — package-based chunker configuration (introduced `package`+`options` for chunkers)
- ADR-011 — JSON config with env-var expansion
- ADR-035 — JSON-only config
