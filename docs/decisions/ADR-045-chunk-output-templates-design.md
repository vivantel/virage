---
id: ADR-045
title: Chunk output templates — design and deferred implementation
status: Accepted
date: 2026-07-03
related: [ADR-043, ADR-044, ADR-037]
---

## Context

Different retrieval strategies benefit from different text representations of the same chunk. For example:

- A knowledge-graph chunker might produce a raw node description, but for dense embedding the best input is `"{{ breadcrumb }}\n\n{{ body }}"` (section context + body).
- For BM25 sparse search, the raw body without breadcrumb prefix is usually better.

Until now, `denseText` and `sparseText` were fully determined by the chunker package itself, leaving no config-level way to customize the text representations without forking the package.

## Decision

Add an optional `templates` field to each chunker config entry:

```typescript
type TemplateValue = string | { file: string };

interface ChunkerTemplate {
  denseText?: TemplateValue;  // rendered minijinja; result replaces denseText
  sparseText?: TemplateValue; // rendered minijinja; result replaces sparseText
}
```

**Format:**
- `string` — inline minijinja template (e.g. `"{{ breadcrumb }}\n\n{{ body }}"`)
- `{ file: string }` — path to a `.jinja` template file, resolved relative to the config file's directory

**Template context** (available variables in the minijinja template):
```
breadcrumb     — string[] joined with " › "
body           — raw chunk body text (sparseText before any template)
file_path      — source file path
file_set_name  — name of the fileSet
tags           — string[] of chunk tags
metadata       — full ChunkMeta as an object
```

**Rendering:** Templates are applied post-chunking, pre-embedding, inside `ChunkProcessor`. Rendering replaces `chunk.denseText` (or `sparseText`) with the rendered string.

**Template file resolution:** `{ file: "./templates/codegraph.jinja" }` is resolved relative to the directory containing `virage.config.json`.

**Deferred implementation:** The actual minijinja rendering requires a Rust napi-rs or WASM package (`@vivantel/virage-renderer-minijinja`). Until that package ships, `ChunkProcessor.applyTemplates()` is a no-op stub that logs a debug warning if templates are configured. The config schema accepts `templates` today.

## Consequences

- **+** Config-level text representation customization without forking chunker packages.
- **+** File references allow sharing templates across projects.
- **+** Schema is defined now; implementation follows independently.
- **−** Until `virage-renderer-minijinja` ships, templates are silently ignored.
- **−** Template rendering adds overhead to the chunking phase.

## Alternatives Considered

**Post-embedding templates (rewrite stored texts):** Would require re-embedding when templates change. Rejected — pre-embedding is cheaper and templates logically belong to the text preparation step.

**Only inline strings, no file references:** Simpler but unusable for large or shared templates. Rejected.

## References

- ADR-043 — FileSets config entities (templates live on `ChunkerConfig`)
- ADR-037 — generator IDs (template changes should change the `denseTextHash`)
