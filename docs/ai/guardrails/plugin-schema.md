# Plugin Options Schema Rules

> See ADR-047 before writing or modifying a plugin's `optionsSchema`.

Every published Virage plugin (embedder, store, reranker) must export a Zod schema named `optionsSchema`. This allows the config loader to validate plugin options at startup and produce precise error messages.

## Required export

```typescript
import { z } from "zod";

export const optionsSchema = z.object({
  // required field — no .optional()
  apiKey: z.string().describe("API key"),
  // required with constraints
  dimensions: z.number().int().positive().describe("Embedding dimensions"),
  // optional field with description
  baseURL: z.string().url().optional().describe("Custom API base URL"),
});

export type PluginOptions = z.infer<typeof optionsSchema>;
```

The factory function (`createEmbedder`, `createVectorStore`, etc.) **must** accept `PluginOptions`:

```typescript
export function createEmbedder(opts: PluginOptions): EmbeddingProvider { ... }
```

## Rules

1. **Required fields** — any field without a default must be non-optional in the Zod schema (not `.optional()`). If the field is required, fail fast at parse time with a clear message.

2. **Optional fields** — use `.optional()` for fields that have a sensible runtime default. Document the default in `.describe()`.

3. **Backward compat on new options** — when adding a new option to an existing plugin, always add it as `.optional()`. This ensures users who haven't set the new option don't get a validation error.

4. **`PluginOptions` type** — always export `PluginOptions = z.infer<typeof optionsSchema>`. Never write the type manually — derive it from the schema.

5. **Zod version** — add `zod` as a regular `dependency` (not `peerDependency`) in the plugin's `package.json`. Keep version in sync with the monorepo root.

6. **After schema changes** — run `npm run type-check` from the repo root to verify no type errors were introduced.

7. **Factory signature** — the factory receives parsed/validated options. Do not re-validate inside the factory — trust the schema output.

## Example: adding a new optional field

```typescript
// Before
export const optionsSchema = z.object({
  model: z.string(),
  dimensions: z.number().int().positive(),
});

// After — add cacheDir as optional
export const optionsSchema = z.object({
  model: z.string(),
  dimensions: z.number().int().positive(),
  cacheDir: z.string().optional().describe("Model cache directory (default: ~/.virage/model-cache)"),
});
```

Existing configs that don't set `cacheDir` continue to work without modification.
