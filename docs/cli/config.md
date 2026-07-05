# virage.config.json Reference

Full reference for the `virage.config.json` configuration file. Generate a starter config with `virage init`.

## Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$schema` | string | No | URL to the JSON Schema for IDE autocomplete |
| `version` | string | No | Config schema version (semver). Bump when making breaking changes. |
| `providers` | object | **Yes** | Embedder, vector store, re-ranker, and source provider |
| `fileSets` | array | **Yes** | One or more named groups of files to index |
| `ignore` | string[] | No | Global glob patterns excluded from all file sets |
| `search` | object | No | Search behaviour (hybrid, alpha, re-rank oversample) |
| `agents` | array | No | Agent plugins to configure (e.g. Claude Code, Copilot) |
| `pipeline` | object | No | Throughput and concurrency tuning |
| `telemetry` | object | No | Telemetry configuration (provider-specific) |
| `quality` | object | No | Quality pipeline configuration |

`${ENV_VAR}` patterns are expanded from the environment at runtime in any string value.

---

## `providers`

Declares the plugin to use for each provider role. All providers use the `PluginRef` shape.

### `PluginRef` shape

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `package` | string | **Yes** | npm package name |
| `packageVersion` | string | No | Pinned version (managed by `virage update`) |
| `options` | object | No | Plugin-specific options (varies by plugin) |

### `providers.embedder` (required)

The embedding model plugin.

```json
"embedder": {
  "package": "@vivantel/virage-embedder-fastembed",
  "options": { "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 }
}
```

### `providers.vectorStore` (required)

The vector store plugin.

```json
"vectorStore": {
  "package": "@vivantel/virage-store-lancedb",
  "options": { "uri": ".virage/lancedb" }
}
```

### `providers.reranker` (optional)

Re-ranker plugin for post-retrieval result reordering.

### `providers.source` (optional)

Global source provider override. When set, all file sets read from this source instead of the local filesystem. Can be overridden per-fileSet with `fileSets[].source`.

---

## `fileSets`

An array of named file groups. At least one is required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **Yes** | Unique name for this file set |
| `source` | PluginRef | No | Per-fileSet source provider override |
| `include` | string[] | No | Glob patterns to include |
| `ignore` | string[] | No | Glob patterns to exclude (in addition to top-level `ignore`) |
| `tags` | string[] | No | Tags injected into every chunk from this file set |
| `tagRules` | TagRule[] | No | Per-file glob-based tag injection |
| `chunkers` | ChunkerConfig[] | **Yes** | One or more chunker plugins (min 1) |

### `TagRule`

```json
{ "match": "src/payments/**", "add": ["team:payments", "pci-scope"] }
```

### `ChunkerConfig`

Extends `PluginRef` with optional chunking templates.

| Field | Type | Description |
|-------|------|-------------|
| `package` | string | Chunker plugin package name |
| `packageVersion` | string | Pinned version |
| `options` | object | Chunker-specific options |
| `templates.denseText` | string \| `{ file: string }` | Template for the dense text embedding target |
| `templates.sparseText` | string \| `{ file: string }` | Template for the sparse text (BM25/FTS) |

---

## `search`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `hybrid` | boolean | `false` | Enable hybrid search (dense + sparse) |
| `hybridAlpha` | number (0–1) | `0.5` | Weight for dense vs sparse in hybrid mode (1 = dense only, 0 = sparse only) |
| `rerankOversample` | integer | `3` | Fetch `topK × rerankOversample` candidates before re-ranking |

---

## `pipeline`

Tuning knobs for the indexing pipeline. All fields are optional. CLI flags override config values.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `force` | boolean | `false` | Re-embed all chunks, bypassing file-change and hash dedup |
| `skipUpload` | boolean | `false` | Embed but skip uploading to the vector store |
| `dryRun` | boolean | `false` | Show what would change without writing anything |
| `embeddingsFile` | string | — | Path to a pre-computed embeddings JSON file |
| `noBanner` | boolean | `false` | Suppress the startup banner |
| `rateLimitMs` | number | `0` | Minimum ms between embedding API calls |
| `batchSize` | integer | — | Max chunks per embedding API request (plugin default applies if unset) |
| `maxBatchChars` | integer | — | Max total characters per embedding API request |
| `concurrency` | integer | — | Files processed in parallel |
| `chunkConcurrency` | integer | — | Chunking workers per file |
| `minEmbeddingBatchSize` | integer | `10` | Minimum chunks to accumulate before sending an embedding request |
| `minUploadingBatchSize` | integer | `20` | Minimum chunks to accumulate before uploading to the vector store |
| `maxPendingFiles` | integer | — | Backpressure: max files queued for chunking before pausing reads |

---

## `agents`

An array of agent plugin refs. Each entry uses the `PluginRef` shape.

```json
"agents": [
  { "package": "@vivantel/virage-agent-claude" },
  { "package": "@vivantel/virage-agent-copilot" }
]
```

---

## Minimal example

```json
{
  "$schema": "https://unpkg.com/@vivantel/virage-core/schemas/virage.config.schema.json",
  "version": "2.0.0",
  "providers": {
    "embedder": {
      "package": "@vivantel/virage-embedder-fastembed",
      "options": { "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 }
    },
    "vectorStore": {
      "package": "@vivantel/virage-store-lancedb",
      "options": { "uri": ".virage/lancedb" }
    }
  },
  "fileSets": [
    {
      "name": "main",
      "include": ["src/**", "docs/**"],
      "ignore": ["**/node_modules/**", "**/dist/**"],
      "chunkers": [
        { "package": "@vivantel/virage-code-chunk-chunker" }
      ]
    }
  ]
}
```

## Full annotated example

```json
{
  "$schema": "https://unpkg.com/@vivantel/virage-core/schemas/virage.config.schema.json",
  "version": "2.0.0",
  "providers": {
    "embedder": {
      "package": "@vivantel/virage-embedder-openai",
      "packageVersion": "~0.2.55",
      "options": {
        "apiKey": "${OPENAI_API_KEY}",
        "model": "text-embedding-3-small",
        "dimensions": 1536
      }
    },
    "vectorStore": {
      "package": "@vivantel/virage-store-lancedb",
      "packageVersion": "~0.2.70",
      "options": { "uri": ".virage/lancedb" }
    },
    "reranker": {
      "package": "@vivantel/virage-reranker-cohere",
      "options": { "apiKey": "${COHERE_API_KEY}" }
    }
  },
  "fileSets": [
    {
      "name": "docs",
      "include": ["docs/**/*.md"],
      "ignore": ["docs/internal/**"],
      "tags": ["format:markdown"],
      "tagRules": [
        { "match": "docs/api/**", "add": ["team:platform"] }
      ],
      "chunkers": [
        { "package": "@vivantel/virage-chunker-ce-md" }
      ]
    },
    {
      "name": "source",
      "include": ["src/**/*.ts"],
      "ignore": ["src/**/*.test.ts"],
      "tags": ["lang:typescript"],
      "chunkers": [
        { "package": "@vivantel/virage-code-chunk-chunker" }
      ]
    }
  ],
  "ignore": ["**/node_modules/**", "**/dist/**", "**/*.min.js"],
  "agents": [
    { "package": "@vivantel/virage-agent-claude" }
  ],
  "search": {
    "hybrid": true,
    "hybridAlpha": 0.6,
    "rerankOversample": 3
  },
  "pipeline": {
    "rateLimitMs": 200,
    "batchSize": 20,
    "concurrency": 4,
    "minEmbeddingBatchSize": 10,
    "minUploadingBatchSize": 20
  }
}
```

---

## V1 → V2 migration

If you have a V1 config (with top-level `embedder`, `vectorStore`, `chunking`), `virage init` will generate a V2 config. The key structural changes:

| V1 | V2 |
|----|----|
| `embedder` (top-level) | `providers.embedder` |
| `vectorStore` (top-level) | `providers.vectorStore` |
| `chunking.chunkers` | `fileSets[].chunkers` |
| `chunking.exclude` | `fileSets[].ignore` or top-level `ignore` |
| `options.*` | `pipeline.*` |
| `pluginVersions` | `providers.*.packageVersion` / `fileSets[].chunkers[].packageVersion` |
