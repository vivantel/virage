# virage.config.json Reference

Full reference for the `virage.config.json` configuration file. Generate a starter config with `virage init`.

## Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$schema` | string | No | URL to the JSON Schema for IDE autocomplete |
| `version` | string | No | Config schema version (semver). Bump when making breaking changes. |
| `retrieval` | object | No | Retrieval contract v0 settings — see [`retrieval`](#retrieval) |
| `providers` | object | **Yes** | Embedder, vector store, re-ranker, and source provider |
| `fileSets` | array | **Yes** | One or more named groups of files to index |
| `ignore` | string[] | No | Global glob patterns excluded from all file sets |
| `search` | object | No | Search behaviour (hybrid, alpha, re-rank oversample) |
| `agents` | array | No | Agent plugins to configure (e.g. Claude Code, Copilot) |
| `pipeline` | object | No | Throughput and concurrency tuning |
| `logging` | object | No | Structured logging level (and, in some builds, remote transport sinks) — see [`logging`](#logging) |
| `telemetry` | object | No | Telemetry configuration (provider-specific) |
| `quality` | object | No | Quality pipeline configuration |

`${ENV_VAR}` patterns are expanded from the environment at runtime in any string value.

---

## `providers`

Declares the plugin to use for each provider role. All providers use the `PluginRef` shape.

### `PluginRef` shape

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `builtin` | string | One of `builtin` or `package` | Built-in shorthand key (e.g. `"onnx"`, `"lancedb"`, `"cross-encoder"`) |
| `package` | string | One of `builtin` or `package` | Full npm package name |
| `packageVersion` | string | No | Pinned version (managed by `virage update`) |
| `options` | object | No | Plugin-specific options (varies by plugin) |

`builtin` and `package` are mutually exclusive. `builtin` keys are resolved to their full package names at parse time — use whichever is more readable. All built-in keys are listed in [docs/packages/](../packages/).

### `providers.embedder` (required)

The embedding model plugin.

```json
"embedder": {
  "builtin": "onnx",
  "options": {
    "source": { "model": "Xenova/all-MiniLM-L6-v2", "cacheDir": ".virage/model-cache" },
    "dimensions": 384
  }
}
```

Or with an explicit npm package:

```json
"embedder": {
  "package": "@vivantel/virage-embedder-openai",
  "options": { "apiKey": "${OPENAI_API_KEY}", "model": "text-embedding-3-small", "dimensions": 1536 }
}
```

See [docs/packages/embedders.md](../packages/embedders.md) for all embedder options.

### `providers.vectorStore` (required)

The vector store plugin.

```json
"vectorStore": {
  "builtin": "lancedb",
  "options": { "uri": ".virage/lancedb" }
}
```

### `providers.reranker` (optional)

Re-ranker plugin for post-retrieval result reordering. When configured, `virage query` automatically re-scores and re-sorts results — no extra flag required.

```json
"reranker": {
  "builtin": "cross-encoder",
  "options": {
    "source": { "model": "Xenova/ms-marco-MiniLM-L-6-v2", "cacheDir": ".virage/model-cache" }
  }
}
```

See [docs/packages/rerankers.md](../packages/rerankers.md) for all reranker options.

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
This table reflects the current Rust engine (`virage-engine`, ADR-053+) — fields below are the
ones actually read by `crates/virage-engine/src/config/mod.rs`'s `PipelineOptions`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `force` | boolean | `false` | Re-embed all chunks, bypassing file-change and hash dedup |
| `dryRun` | boolean | `false` | Show what would change without writing anything |
| `concurrency` | integer | CPU core count | Worker ceiling — max files processed in parallel |
| `concurrencyStrategy` | `"fixed"` \| `"ramSampling"` | `"ramSampling"` for `virage index`, `"fixed"` for `virage bench index` (ADR-057) | How the active worker count is chosen. `"ramSampling"` scales workers `1..concurrency` based on live free system memory, throttling under pressure. `"fixed"` pins `concurrency` for the whole run. An explicit `concurrency` value with no `concurrencyStrategy` also implies `"fixed"`, matching the pre-ADR-057 meaning of `--workers N`. |
| `minUploadingBatchSize` | integer | `64` | Minimum chunks to accumulate before a vector-store write (each write is a full store commit, not a cheap append) |

**Not implemented** (accepted by `virage init`'s older wizard output or copied from older docs, but silently
ignored by the current Rust engine — remove them from your config, they do nothing): `skipUpload`
(use `virage index --no-upload` instead), `embeddingsFile`, `noBanner` (use `--no-banner` or
`VIRAGE_NO_BANNER=1`), `rateLimitMs`, `batchSize`, `maxBatchChars`, `chunkConcurrency`,
`minEmbeddingBatchSize`, `maxPendingFiles`. These were config surface for the pre-ADR-053
TypeScript pipeline; if you rely on any of them, please file an issue — this note exists so a
silently-no-op config value doesn't look like a supported knob.

---

## `logging`

Structured logging via `tracing`. All fields are optional; the whole block may be omitted.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | string | `"info"` | `tracing_subscriber::EnvFilter` directive string (e.g. `"debug"`, `"virage_engine=debug,warn"`). Overridden at runtime by the `RUST_LOG` env var when set. |
| `transports` | array | `[]` | Remote log sinks. Parsed but not interpreted here — requires a downstream build with transport support to have any effect. |

Logs are always JSON, always written to stdout; there is no TTY-detected pretty-print mode. No
file-writer rotation is provided — if you configure a log file, manage rotation externally (e.g.
`logrotate`).

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

## `retrieval`

Settings for projects where a host tool owns the agent hook and MCP entry (retrieval contract v0).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `conformance` | boolean | auto | `true`: conformance mode on. `false`: off. Absent: on if `.go-getter/retrieval/policy.json` exists, off otherwise. |

```json
"retrieval": { "conformance": true }
```

In conformance mode `virage init` / `virage update`:

- register **no** MCP entry in `.mcp.json` and **no** hook in `.claude/settings.json`, and do not
  copy plugin files that register a hook or MCP server, or slash commands that need the MCP server
  (`/arch`, `/doc`, `/plan`, `/rag`, `/review`, `/usage`);
- write `.go-getter/retrieval/virage.json` (`contractVersion`, `tool`, `toolVersion`,
  `preIndexSecretScan`, `registersHostConfig: false`), at init and at every update.

Entries written by older versions are left alone; `virage uninstall` removes them.

Without a policy file and without this field nothing changes for existing projects.

### Pre-index secret scan

In conformance mode every file is scanned for secrets **before** it is chunked and embedded, and a file with a finding is skipped. The declaration reports `preIndexSecretScan: true`.

- Covers the raw file and the chunk text (so text extracted from PDF/DOCX is checked too). One finding skips the whole file.
- Detects private-key blocks, AWS access key ids, GitHub / Slack / Google / Stripe / `sk-` API tokens, JWTs, and high-entropy values assigned to names like `password`, `secret`, `token` or `api_key` (placeholders and environment lookups are ignored). It is a heuristic filter, not a guarantee.
- The output names the **file path and the kind of finding only**; the matched text is never logged or stored.
- A skipped file is removed from the index if an earlier version of it was indexed.
- Only files being (re)indexed are scanned. After turning conformance mode on for an existing index, run `virage index --force` once so unchanged files are scanned too.

Outside conformance mode nothing is scanned.

### Index policy

`.go-getter/retrieval/policy.json` is owned by the host tool; virage only reads it, **before every index run and every query** (including a warm `query-serve` daemon and `virage serve`, which re-read it per query, and `index --watch`, which re-reads it before each re-index).

```json
{
  "contractVersion": 0,
  "ignore": ["**/.env", "secrets/**"],
  "embedders": ["local"],
  "dataClass": "internal"
}
```

| Field | Effect |
|-------|--------|
| `ignore` | gitignore-syntax globs. A matching file is never indexed and never returned in results, in addition to the `ignore` / `include` of `fileSets`. Negations (`!x`) are ignored: they never un-ignore. |
| `embedders` | Allowed embedder kinds. `local` runs on this machine; `hosted` sends chunk text off it. An embedder whose kind is not listed is refused. Only known local packages (`embedder-onnx`, `embedder-fastembed`, `embedder-transformers`, `embedder-dylib`) count as `local`; any other package counts as `hosted`. |
| `dataClass` | `public`, `internal`, `confidential` or `restricted`. Validated, not interpreted: the host derives `embedders` from it. |
| `contractVersion` | Must be `0`. |

Virage **fails closed**: it refuses to index or query when the file exists but is unreadable, is missing a field, has an invalid field, or has an unknown `contractVersion`, and, in conformance mode, when the file is missing. The file is enforced whenever it exists, even if `retrieval.conformance` is `false`. Refusals name the path, field or embedder kind only, never file contents. Unknown fields are ignored.

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
    "concurrency": 4,
    "concurrencyStrategy": "fixed",
    "minUploadingBatchSize": 64
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
