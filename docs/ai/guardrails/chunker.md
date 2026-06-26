# Guardrail: Plugin Contract

Every chunker package MUST export a `createChunker` factory and include a `rag-plugin` manifest in its `package.json`.

## Required Export

```typescript
export function createChunker(opts?: MyOptions): ArtifactChunker;
```

CE/EE chunkers are built with `createNativeChunker` from `@vivantel/virage-chunker-ce-ast`:

```typescript
import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";

export const createChunker = createNativeChunker<MyOptions>({
  name: "@vivantel/virage-chunker-ce-pdf",
  version: "0.1.0",
  sourceFormat: "pdf",
  patterns: ["**/*.pdf"],
  loadBinding: () => require("./virage_chunker_ce_pdf.node"),
  callNative: (b, buf) => b["parsePdf"](buf),
});
```

## `ArtifactChunker` Interface

```typescript
interface ArtifactChunker {
  name: string;          // package name, e.g. "@vivantel/virage-chunker-ce-pdf"
  version: string;       // semver string, e.g. "0.1.0"
  patterns: string[];    // glob patterns this chunker handles
  sparseTextId: string;  // stable fingerprint: "${name}@${version}:sparse:${optsFp}"
  contextTextHash: string; // stable fingerprint: "${name}@${version}:ctx:${optsFp}"
  chunk(filePath: string, commitHash: string): Promise<ArtifactSet[]>;
  canProcess?(filePath: string): Promise<boolean>;
}
```

`ArtifactChunker` is structurally compatible with `FileChunker` from `@vivantel/virage-core` (≥ 0.2.57).

## `ArtifactSet` (output of `chunk()`)

```typescript
interface ArtifactSet {
  denseText: string;     // breadcrumb prefix + full body — sent to embedding model
  sparseText: string;    // raw body without breadcrumb — used for BM25/FTS
  contextText: string;   // body + boundary padding — passed to LLM
  denseTextHash: string; // sha256(denseText).slice(0,16) — 16-char hex cache key
  metadata: ChunkMeta;   // all enrichment metadata in one flat object
  sourceFile: string;    // source file path
  commitHash: string;    // git commit hash
}
```

## `ChunkMeta` Required Fields

Every `ArtifactSet.metadata` MUST include these fields:

| Field | Type | Notes |
|-------|------|-------|
| `sourceFile` | `string` | repo-relative normalized path |
| `sourceFormat` | `string` | `'md'`, `'pdf'`, `'docx'`, `'latex'`, … |
| `byteStart` | `number` | byte offset of chunk start in source file |
| `byteEnd` | `number` | byte offset one past chunk end |
| `breadcrumb` | `string[]` | heading ancestry path (empty array if unavailable) |
| `strategy` | `string` | package name, e.g. `"@vivantel/virage-chunker-ce-pdf"` |
| `chunkIndex` | `number` | 0-based index within this file |
| `totalChunks` | `number` | total chunks produced from this file |
| `estimatedTokens` | `number` | `Math.ceil(sparseText.length / 4)` |

These are populated automatically by `walkToChunks` / `createNativeChunker`.

## Quality Gates

| Metric | Threshold |
|--------|-----------|
| `breadcrumb` non-empty | ≥ 90% of chunks |
| `byteStart` and `byteEnd` set | 100% of chunks |
| `strategy` matches package name | 100% of chunks |
| `denseTextHash` is 16-char hex | 100% of chunks |
| `denseText` longer than `sparseText` when breadcrumb non-empty | 100% |

## `rag-plugin` Manifest

Every `package.json` MUST include:

```json
{
  "rag-plugin": {
    "type": "chunker",
    "label": "Human-readable label shown in virage init",
    "key": "format-short-name",
    "defaultConfig": {
      "maxTokens": 512
    }
  }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | must be `"chunker"` |
| `label` | yes | shown in `virage init` format selection wizard |
| `key` | yes | telemetry tag and config key |
| `defaultConfig` | no | merged under `strategyOptions` when not overridden |
