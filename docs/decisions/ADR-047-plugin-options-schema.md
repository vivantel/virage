---
id: ADR-047
title: Plugin options schema convention
status: Accepted
date: 2026-07-03
related: [ADR-041, ADR-038, ADR-013]
---

## Context

Plugin option validation was done implicitly: each plugin's factory function (`createEmbedder`, `createVectorStore`, etc.) manually checked options at runtime, producing ad-hoc error messages. This had several problems:

1. Errors were discovered at startup when the plugin tried to use an option, not at config parse time.
2. Error messages varied in quality and format across plugins.
3. There was no machine-readable description of what options a plugin accepted.
4. The config loader had no way to validate options without importing each plugin first and calling it with bad data.

## Decision

Every published Virage plugin must export a Zod schema named `optionsSchema`:

```typescript
import { z } from "zod";

export const optionsSchema = z.object({
  apiKey: z.string().describe("OpenAI API key"),
  model: z.string().describe("Model ID (e.g. text-embedding-3-small)"),
  dimensions: z.number().int().positive().describe("Embedding dimensions"),
  baseURL: z.string().url().optional().describe("Custom base URL"),
});

export type PluginOptions = z.infer<typeof optionsSchema>;
```

The config loader validates options before calling the factory:

```typescript
if (typeof mod.optionsSchema?.parse === 'function') {
  mod.optionsSchema.parse(spec.options ?? {});
}
```

**Duck-typing:** The loader checks for a `.parse()` method — any Zod-compatible schema library works.

**Scope:** All published embedder, store, and reranker packages. Chunker packages (CE native napi-rs) are deferred.

## Consequences

- **+** Option errors are caught at config load time with Zod's precise field-level messages.
- **+** Machine-readable option descriptions for documentation generation.
- **+** New options can be added as `.optional()` without breaking existing configs.
- **−** Each plugin gains a `zod` dependency (~14 KB minzipped).
- **−** Plugins not yet updated silently skip validation (duck-type check fails gracefully).

## Guardrail

See `docs/ai/guardrails/plugin-schema.md` for rules on how to write and evolve `optionsSchema`.

## References

- ADR-041 — unified PluginRef shape (`options` field replaces `config`)
- ADR-038 — package-based chunker configuration
- ADR-013 — plugin discovery via npm exports
