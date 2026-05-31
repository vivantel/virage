# Migration Guide: v1.x → v2.0

v2.0 is a breaking release focused on the plugin ecosystem and production polish.
All v1.3 runtime behavior is preserved — the changes are surface-level API and CLI.

---

## CLI flag renames

| v1.x flag | v2.x flag |
|---|---|
| `--skip-upload` | `--no-upload` |
| `--chunks-file <path>` | `--chunks-out <path>` |
| `--embeddings-file <path>` | `--embeddings-out <path>` |

**Update your CI/CD scripts and package.json scripts:**

```bash
# Before
rag-update --skip-upload --chunks-file ./out/chunks.json

# After
rag-update --no-upload --chunks-out ./out/chunks.json
```

---

## Strategy imports

Strategies are now published as a separate package. The v1.x import still works
but is deprecated and will be removed in v3.0.

```bash
npm install @vivantel/rag-strategies
```

```ts
// Before (deprecated, still works)
import { tokenStrategy } from '@vivantel/rag-core';

// After (preferred)
import { tokenStrategy } from '@vivantel/rag-strategies';
```

---

## Interface additions (non-breaking)

Two optional methods were added to the provider interfaces.
Existing implementations continue to work without changes.

### `EmbeddingProvider`

```ts
// New optional method (v2.0+)
embedStream?(texts: string[]): AsyncIterable<number[]>;
```

### `VectorStore`

```ts
// New optional method (v2.0+)
batchDelete?(ids: string[]): Promise<void>;
```

---

## `RAGPipelineConfig.options` additions

All new fields are optional — existing configs need no changes.

```ts
options: {
  // v1.2 additions
  dryRun?: boolean;

  // v1.3 additions
  retry?: { maxRetries?: number; retryDelayMs?: number; retryBackoffFactor?: number };
  concurrency?: number;
  telemetry?: boolean;
  notifications?: { webhookUrl?: string };
}
```

---

## Plugin discovery (new in v2.0)

```ts
import { discoverPlugins } from '@vivantel/rag-core';

const plugins = await discoverPlugins(['rag-embedder-openai', 'rag-store-pinecone']);
```

A plugin package must export `ragPlugin: RagPlugin` or `ragPlugins: RagPlugin[]`.

---

## Watch mode (new in v2.0)

```bash
rag-update --watch
```

Re-runs the pipeline automatically whenever config or source files change.

---

## v1.x support policy

v1.x receives **no further updates** after v2.0.0. There is no backport window.
Pin `@vivantel/rag-core@^1` in your lockfile if you need more time to migrate.

---

## Planned companion packages (future releases)

| Package | Status |
|---|---|
| `@vivantel/rag-strategies` | ✅ Available (v2.0) |
| `@vivantel/rag-embedder-openai` | Planned |
| `@vivantel/rag-embedder-github` | Planned |
| `@vivantel/rag-store-pinecone` | Planned |
| `@vivantel/rag-chunker-event` | Planned |
