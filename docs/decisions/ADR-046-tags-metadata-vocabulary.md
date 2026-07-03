---
id: ADR-046
title: Tags as the unified metadata vocabulary
status: Accepted
date: 2026-07-03
related: [ADR-043, ADR-028]
---

## Context

Virage used `labels` as the term for metadata annotations on chunks:
- `ChunkMeta.labels?: string[]`
- `LabelRule` interface
- `labelFilter?: string[]` in `SearchOptions`
- `VectorDocument.labels?: string[]`
- `label-pipeline.ts`

"Labels" is overloaded across software systems (Git tags are sometimes called labels, Kubernetes uses labels for pod metadata, GitHub has issue labels, etc.). In the content annotation domain, "tags" is the universally understood term used by S3 object tagging, GitHub topic tags, npm tags, and other relevant systems.

## Decision

Rename throughout the codebase:

| Before | After |
|---|---|
| `ChunkMeta.labels` | `ChunkMeta.tags` |
| `LabelRule` | `TagRule` |
| `SearchOptions.labelFilter` | `SearchOptions.tagFilter` |
| `VectorDocument.labels` | `VectorDocument.tags` |
| `label-pipeline.ts` | `tag-pipeline.ts` |
| `applyLabelRules()` | `applyTagRules()` |
| `resolveLabels()` | (removed — function replaced by fileSet-level tag injection) |
| `globalLabelRules` in RAGPipelineConfig | (removed — replaced by fileSet `tagRules`) |

**Tag naming convention:** `"namespace:value"` (e.g. `"team:payments"`, `"lang:typescript"`, `"format:markdown"`). The colon separator follows the same convention used by GitHub Topics, npm tags, and Kubernetes label keys.

**Breaking change.** All code consuming `ChunkMeta.labels` must update to `ChunkMeta.tags`. Vector store metadata stored under the `labels` JSON key from pre-ADR-046 indexes will appear as missing `tags` — a forced re-index is required.

## Consequences

- **+** Clearer terminology — "tags" universally understood for content annotation.
- **+** Consistent with S3 object tagging, GitHub Topics, and EE RBAC roadmap vocabulary.
- **−** Breaking change for stored index metadata (`labels` → `tags` in `metadata_json`).

## References

- ADR-043 — FileSets (tags and tagRules are fileSet-level config fields)
- ADR-028 — Branch-aware RAG (original label system for branch tagging)
