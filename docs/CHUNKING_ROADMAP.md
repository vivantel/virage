# Chunking System Roadmap

## Overview

The current chunking system handles TypeScript/JavaScript/Python/Go/Java/Rust source code via tree-sitter AST (`virage-code-chunk-chunker`) and Markdown via heading-split (`markdownHeaders`). Both strategies produce opaque `metadata: Record<string, unknown>` with no standardised shape, no breadcrumb path, no byte offsets, and no file-level provenance.

This roadmap defines a new, fully extensible chunking platform with three headline improvements:

1. **Format coverage** — structured document formats (PDF, DOCX, LaTeX, …) alongside existing code/text
2. **Parse performance** — Rust native parsers exposed to Node.js via **napi-rs**, the same model used by `better-sqlite3` which already ships in `virage-core`
3. **Rich adaptive metadata** — every chunk carries a standardised `ChunkMeta` object: hierarchy breadcrumb, byte/line/page offsets, file-level provenance, BCP-47 language tag, and observability signals

Enterprise Edition (EE) chunkers (XLSX, PPTX, HTML, ePub, RST) live in the separate private repository `vivantel/virage-chunkers-ee` — see `docs/EE_CHUNKING_ROADMAP.md` in that repo.

---

## Design Decisions

### D-1 · Rust exposure: napi-rs

**Decision:** Format-specific parsers are written in Rust and exposed via [`napi-rs`](https://napi.rs) as Node.js native addons. Per-platform pre-built binaries are published as optional npm packages (`@vivantel/virage-chunker-ce-pdf-linux-x64-gnu`, etc.) and downloaded transparently by the main package's `optionalDependencies`.

**Rationale:**
- Identical to the `better-sqlite3` + `prebuild-install` pattern already accepted in `virage-core`; no new toolchain concepts for contributors
- 3–10× faster than equivalent JS for binary parsing (PDF streams, ZIP-based OOXML, LaTeX tokenisation)
- Platform matrix (linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64) covered by GitHub Actions; WASM fallback possible per-package as a phase-4 addition

**Alternatives considered:**
- WASM via `wasm-bindgen` — portable but ~15% slower, ~2 MB per package added to npm bundle; ruled out as the primary path but viable for browser-facing environments in a future release
- Pure TypeScript (pdf.js, mammoth) — zero native deps, fastest to ship, but single-threaded and slow on large corpora; kept as a TS-first fallback for Phase 1 and as a graceful degradation layer

### D-2 · CE/EE split: private npm registry

**Decision:** CE chunkers live in this monorepo and are published to the public npm registry. EE chunkers live in the separate private repository `vivantel/virage-chunkers-ee` and are published to GitHub Packages under the `@vivantel` scope, gated by `VIRAGE_EE_TOKEN`.

**Rationale:**
- Cleanest IP boundary — EE source code never ships to CE users
- Leverages `importPackage()`'s five-tier resolution (already used for embedders/stores), so EE chunkers install and load identically to CE ones; no special loader code needed

**Alternatives considered:**
- Git subtree into this repo — keeps one build pipeline but makes EE source visible to all repo contributors
- Feature flags / license key in same codebase — simplest distribution but ships proprietary algorithms to all CE users

### D-3 · Unified AST: custom ViDoc AST

**Decision:** A new `DocNode` tree (the "ViDoc AST") is defined in `virage-core` as the internal representation shared by all structured-document chunkers. Rust parsers serialize it as JSON across the napi-rs boundary; the TypeScript chunking layer deserializes and walks it.

**Rationale:**
- Full control over the node schema: every field is designed for RAG use (breadcrumb, byte offsets, page number, semantic role, language tag)
- No dependency on Unist's string-typed `type` system or Pandoc's binary requirement

**Alternatives considered:**
- Unist-compatible (mdast superset) — excellent ecosystem but spreadsheet cells, LaTeX math environments, and PDF structure maps awkwardly onto Unist's `node.data.virage` extension pattern
- Pandoc JSON AST — handles 40+ formats but requires the `pandoc` binary on PATH, not optimised for chunk metadata

---

## Plugin Naming Convention

```
@vivantel/virage-chunker-{edition}-{format}
```

- `edition` is `ce` (Community Edition, public npm) or `ee` (Enterprise Edition, private registry)
- `format` is a short, lowercase identifier for the file format or chunking approach

### CE Packages (this monorepo)

| Package | Format | Rust crate(s) | Phase |
|---------|--------|---------------|-------|
| `@vivantel/virage-chunker-ce-md` | Markdown / MDX | — (pure TS, remark) | 1 |
| `@vivantel/virage-chunker-ce-ast` | Generalized ViDoc AST walker | — (pure TS) | 1 |
| `@vivantel/virage-chunker-ce-pdf` | PDF (text layer extraction) | `lopdf`, `pdf-extract` | 2 |
| `@vivantel/virage-chunker-ce-docx` | DOCX / OXML | `docx-rs` | 2 |
| `@vivantel/virage-chunker-ce-latex` | LaTeX | custom lexer | 2 |

EE packages (`@vivantel/virage-chunker-ee-*`) are published from `vivantel/virage-chunkers-ee` and installed via the private GitHub Packages registry.

---

## ViDoc AST Specification

Defined in `packages/virage-core/src/interfaces/vidoc.ts`. The AST is the internal contract between format-specific parsers (Rust or TypeScript) and the generalized `virage-chunker-ce-ast` chunking strategy.

```typescript
// packages/virage-core/src/interfaces/vidoc.ts

export type DocNodeType =
  | "document"
  | "section"
  | "heading"
  | "paragraph"
  | "table"
  | "table-row"
  | "table-cell"
  | "list"
  | "list-item"
  | "code"
  | "formula"
  | "image"
  | "link"
  | "footnote"
  | "caption"
  | "abstract"
  | "metadata";

export interface DocNodeAttrs {
  // ── Structure ─────────────────────────────────────────────────────────
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  role?: "caption" | "footnote" | "abstract" | "toc-entry" | "header" | "footer";

  // ── Hierarchy ─────────────────────────────────────────────────────────
  /** Ancestor heading texts from outermost to innermost, e.g. ['Chapter 1', '§2.3'] */
  breadcrumb?: string[];

  // ── Source mapping ────────────────────────────────────────────────────
  byteStart: number;
  byteEnd: number;
  lineStart?: number;
  lineEnd?: number;
  /** 1-based page number (paginated formats: PDF, DOCX) */
  pageNumber?: number;

  // ── Language ──────────────────────────────────────────────────────────
  lang?: string;            // BCP-47, e.g. 'en', 'de', 'zh-Hans'
  codeLanguage?: string;    // e.g. 'python', 'rust'

  // ── Tabular ───────────────────────────────────────────────────────────
  tableRow?: number;
  tableCol?: number;
  isHeader?: boolean;

  // ── List ──────────────────────────────────────────────────────────────
  listDepth?: number;
  ordered?: boolean;

  // ── Format ────────────────────────────────────────────────────────────
  sourceFormat?: "md" | "pdf" | "docx" | "latex" | "xlsx" | "html" | "epub" | "rst" | string;
}

export interface DocNode {
  type: DocNodeType;
  children?: DocNode[];
  text?: string;   // leaf text content
  attrs: DocNodeAttrs;
}
```

### Rust ↔ JS Boundary

Rust parsers serialize the `DocNode` tree as JSON via `serde_json` and return it through the napi-rs boundary as a `String`. The TypeScript side deserializes with a typed cast:

```typescript
// packages/virage-chunker-ce-pdf/src-ts/native.ts
import type { DocNode } from "@vivantel/virage-core";

// napi-rs binding — generated by @napi-rs/cli
declare function parsePdfNative(buf: Buffer): string; // JSON-encoded DocNode

export function parsePdf(buf: Buffer): DocNode {
  return JSON.parse(parsePdfNative(buf)) as DocNode;
}
```

JSON is the stable Rust↔JS interface; TypeScript type assertions live on the JS side, so Rust crates stay decoupled from TypeScript type evolution.

---

## Plugin Contract

Every chunker package (CE or EE) must export a `createChunker` factory. The loader (`strategy-registry.ts`) calls it when `"strategy": "package"` is configured.

```typescript
// Required export from every chunker package
export function createChunker(opts: ChunkerOptions): FileChunker;

// or async if initialisation is needed
export async function createChunker(opts: ChunkerOptions): Promise<FileChunker>;
```

### Core Interfaces (from `@vivantel/virage-core`)

```typescript
import type {
  Chunk,           // the unit of indexing
  FileChunker,     // what createChunker() must return
  ChunkStrategy,   // optional lower-level abstraction (strategy pattern)
  createChunker,   // helper to build a FileChunker from a ChunkStrategy
} from "@vivantel/virage-core";

// Chunk — emitted by every chunker
interface Chunk {
  content: string;
  metadata: Record<string, unknown>; // should conform to ChunkMeta
  sourceFile: string;
  commitHash: string;
  contentHash?: string;
}

// FileChunker — the contract the loader expects
interface FileChunker {
  name: string;
  patterns: string[];
  chunk(filePath: string, commitHash: string): Promise<Chunk[]>;
  canProcess?(filePath: string, content?: string): Promise<boolean>;
}

// ChunkStrategy — optional split-text-into-chunks abstraction
interface ChunkStrategy {
  name: string;
  chunk(text: string, filePath?: string): Promise<Chunk[]>;
  extractMetadata?(text: string, filePath?: string): Record<string, unknown>;
  getQualityMetrics?(chunks: Chunk[]): ChunkQualityMetrics;
}
```

### `createChunker` helper

Use the `createChunker` helper from `virage-core` to avoid re-implementing file-reading and ignore-pattern logic:

```typescript
import { createChunker } from "@vivantel/virage-core";

export function createChunker(opts: MyChunkerOptions): FileChunker {
  return createChunker({
    patterns: ["**/*.pdf"],
    ignorePatterns: opts.ignore,
    strategy: new MyPdfStrategy(opts),
  });
}
```

### `rag-plugin` Manifest

Every chunker package must include a `"rag-plugin"` field in its `package.json` for auto-discovery:

```json
{
  "rag-plugin": {
    "type": "chunker",
    "label": "Human-readable label shown in virage init wizard",
    "key": "format-short-name",
    "defaultConfig": {
      "maxTokens": 512,
      "overlapSentences": 1
    }
  }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | must be `"chunker"` |
| `label` | yes | shown in `virage init` format selection |
| `key` | yes | used as config key and telemetry tag |
| `defaultConfig` | no | merged under `strategyOptions` if not overridden |

---

## Adaptive Chunking Metadata (`ChunkMeta`)

Every chunker MUST populate `ChunkMeta` on each `Chunk.metadata`. The interface extends the current freeform `Record<string, unknown>` by making the standard fields required.

```typescript
// packages/virage-core/src/interfaces/chunk-meta.ts

export interface ChunkMeta extends Record<string, unknown> {
  // ── Provenance ────────────────────────────────────────────────────────
  sourceFile: string;        // repo-relative normalized path
  sourceFormat: string;      // 'md' | 'pdf' | 'docx' | 'latex' | ...
  byteStart: number;
  byteEnd: number;
  lineStart?: number;
  lineEnd?: number;
  pageStart?: number;        // paginated formats
  pageEnd?: number;

  // ── File-level ────────────────────────────────────────────────────────
  fileSizeBytes?: number;
  fileModifiedAt?: string;   // ISO 8601
  fileHash?: string;         // SHA-256 of raw file bytes

  // ── Hierarchy / breadcrumb ────────────────────────────────────────────
  breadcrumb: string[];
  sectionTitle?: string;
  headingLevel?: number;
  documentOutline?: string[];

  // ── Language ──────────────────────────────────────────────────────────
  lang?: string;             // BCP-47, e.g. 'en', 'de', 'zh-Hans'
  codeLanguage?: string;

  // ── Chunker identity ──────────────────────────────────────────────────
  strategy: string;          // e.g. '@vivantel/virage-chunker-ce-pdf@1.0.0'
  chunkIndex: number;
  totalChunks: number;

  // ── Observability ─────────────────────────────────────────────────────
  estimatedTokens: number;   // chars / 4
  qualityScore?: number;     // composite 0–1
  truncated?: boolean;
}
```

### Metadata Completeness by Format

| Field | md | code AST | pdf | docx | xlsx | latex |
|-------|----|----------|-----|------|------|-------|
| `breadcrumb` | ✓ | partial | ✓ | ✓ | sheet name | ✓ |
| `byteStart/End` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lineStart/End` | ✓ | ✓ | — | — | ✓ | ✓ |
| `pageStart/End` | — | — | ✓ | ✓ | — | ✓ |
| `lang` | manual | — | detected | detected | manual | detected |
| `documentOutline` | ✓ | — | ✓ | ✓ | sheet list | ✓ |
| `fileHash` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`detected` = automatic via lingua-rs (Phase 4). `manual` = from config or file meta.

---

## Generalized AST Chunker (`virage-chunker-ce-ast`)

The shared TypeScript chunking strategy used by all structured-document parsers. Format-specific parsers produce a `DocNode` tree; this strategy walks it and emits `Chunk[]`.

```
packages/virage-chunker-ce-ast/
├── src/
│   ├── index.ts          # export createChunker(opts) → FileChunker
│   ├── ast-walker.ts     # depth-first DocNode traversal → text segments
│   ├── chunker.ts        # segments → Chunk[] with ChunkMeta, token windowing
│   └── outline.ts        # extract documentOutline from DocNode tree
└── __test__/
    ├── ast-walker.spec.ts
    └── chunker.spec.ts
```

### Algorithm

```
walk(root: DocNode, maxTokens: number): Chunk[]

1. Depth-first traversal collecting (text, attrs) pairs from leaf nodes
2. Maintain a breadcrumb stack updated on entry/exit of heading nodes
3. Buffer segments until estimated token count reaches maxTokens:
     a. Prefer splitting at paragraph/sentence boundaries
     b. If a single paragraph exceeds maxTokens, split mid-text at sentence
4. If the last segment is < minTokens (default: maxTokens / 4), merge into predecessor
5. For each window, emit Chunk with:
     - content: joined text
     - metadata: ChunkMeta {
         breadcrumb: currentBreadcrumbStack,
         sectionTitle: breadcrumb.at(-1),
         byteStart/End: from leaf node attrs,
         estimatedTokens: content.length / 4,
         ...
       }
```

---

## Rust Package Layout (napi-rs)

Template for each Rust-backed CE chunker (illustrated for PDF):

```
packages/virage-chunker-ce-pdf/
├── Cargo.toml                    # [lib] crate-type = ["cdylib"]
├── src/
│   ├── lib.rs                    # #[napi] fn parse_pdf(buf: Buffer) -> Result<String>
│   ├── parser.rs                 # lopdf page/stream extraction
│   ├── structure.rs              # heading detection heuristics → DocNode tree
│   └── vidoc.rs                  # serde structs mirroring DocNode interface
├── src-ts/
│   ├── index.ts                  # createChunker(opts): FileChunker
│   ├── native.ts                 # binding import + type cast
│   └── strategy.ts               # delegates to virage-chunker-ce-ast walker
├── package.json
├── npm/
│   ├── linux-x64-gnu/            # platform stub packages
│   ├── linux-arm64-gnu/
│   ├── darwin-x64/
│   ├── darwin-arm64/
│   └── win32-x64-msvc/
└── __test__/
    └── pdf.spec.ts
```

### CI Platform Matrix

```yaml
# .github/workflows/build-chunker-ce-pdf.yml
strategy:
  matrix:
    include:
      - { os: ubuntu-latest, target: x86_64-unknown-linux-gnu }
      - { os: ubuntu-latest, target: aarch64-unknown-linux-gnu }
      - { os: macos-latest,  target: x86_64-apple-darwin }
      - { os: macos-latest,  target: aarch64-apple-darwin }
      - { os: windows-latest, target: x86_64-pc-windows-msvc }
```

Each job runs `napi build --release --target <target>`, uploads the `.node` binary, and the publish step assembles them into per-platform optional packages.

### `package.json` Pattern

```json
{
  "name": "@vivantel/virage-chunker-ce-pdf",
  "version": "1.0.0",
  "type": "module",
  "exports": { ".": { "import": "./src-ts/index.js", "types": "./src-ts/index.d.ts" } },
  "peerDependencies": { "@vivantel/virage-core": ">=0.2" },
  "optionalDependencies": {
    "@vivantel/virage-chunker-ce-pdf-linux-x64-gnu":   "1.0.0",
    "@vivantel/virage-chunker-ce-pdf-linux-arm64-gnu": "1.0.0",
    "@vivantel/virage-chunker-ce-pdf-darwin-x64":      "1.0.0",
    "@vivantel/virage-chunker-ce-pdf-darwin-arm64":    "1.0.0",
    "@vivantel/virage-chunker-ce-pdf-win32-x64-msvc":  "1.0.0"
  },
  "rag-plugin": {
    "type": "chunker",
    "label": "PDF (Rust, native)",
    "key": "pdf",
    "defaultConfig": { "maxTokens": 512, "overlapSentences": 1 }
  }
}
```

---

## Config Schema Extension

Add `"package"` as a valid `strategy` value in `JsonChunkerConfig`. When `strategy === "package"`, `config.package` is loaded via the existing `importPackage()` five-tier resolution and its `createChunker(opts)` export is called.

```typescript
// packages/virage-core/src/config-loader.ts (extension)
if (chunkerCfg.strategy === "package") {
  if (!chunkerCfg.package) throw new ConfigError('"package" strategy requires a "package" field');
  const mod = await importPackage(chunkerCfg.package);
  if (typeof mod.createChunker !== "function")
    throw new ConfigError(`${chunkerCfg.package} does not export createChunker()`);
  chunker = await mod.createChunker(chunkerCfg.strategyOptions ?? {});
}
```

### Example Config

```json
{
  "chunking": {
    "exclude": ["**/node_modules/**", "**/dist/**"],
    "chunkers": [
      {
        "name": "markdown",
        "patterns": ["**/*.md", "**/*.mdx"],
        "strategy": "markdownHeaders"
      },
      {
        "name": "code",
        "patterns": ["**/*.ts", "**/*.tsx", "**/*.py", "**/*.go"],
        "strategy": "codeChunkAst"
      },
      {
        "name": "pdf-docs",
        "patterns": ["**/*.pdf"],
        "strategy": "package",
        "package": "@vivantel/virage-chunker-ce-pdf",
        "strategyOptions": { "maxTokens": 512, "overlapSentences": 1 }
      }
    ]
  }
}
```

---

## Format-Specific Design Notes

### Markdown (`virage-chunker-ce-md`)
- **Parser:** Pure TypeScript — `unified` + `remark-parse` produces mdast (Unist AST)
- **Strategy:** Walk mdast, map to DocNode (heading → `heading`, paragraph → `paragraph`, fenced code → `code` with `codeLanguage`). Delegate to `virage-chunker-ce-ast` walker.
- **Breadcrumb:** Built from ancestor `heading` nodes in mdast. Existing `markdownHeaders` users are migrated automatically with the same split boundaries but richer metadata.
- **Extra:** Front-matter (`---`) fields are extracted as `metadata` DocNode attrs (title, author, date, tags → appended to `documentOutline`).

### Code AST (`virage-code-chunk-chunker`)
- **Status quo preserved:** `virage-code-chunk-chunker` continues to use `code-chunk` (tree-sitter). The only change is that its `Chunk.metadata` is shaped to conform to `ChunkMeta`.
- **Breadcrumb:** Class → method path from AST scope chain, e.g. `['MyService', 'processRequest']`.
- **No DocNode intermediary:** Code AST bypasses the ViDoc AST and populates `ChunkMeta` directly — tree-sitter already provides the structure.

### PDF (`virage-chunker-ce-pdf`)
- **Parser (Rust):** `lopdf` for stream decoding; heuristic heading detection (font size > body average → heading, or bookmarks from PDF structure tree).
- **Page numbers:** Extracted from `lopdf` page iterator → `pageStart`/`pageEnd` on each chunk.
- **Limitations:** Scanned/image-only PDFs produce no text; chunker logs a warning and emits zero chunks for those pages.

### DOCX (`virage-chunker-ce-docx`)
- **Parser (Rust):** `docx-rs` reads OOXML ZIP; walks `w:body` elements. `w:style` attributes identify Heading1–Heading6. Tables → `table` DocNodes with cell-level text.
- **Tracked changes:** Accepted-only mode (deletions omitted, insertions included).
- **Images:** `image` DocNode emitted; `alt` text from `descr` attribute used as leaf `text` if present.

### LaTeX (`virage-chunker-ce-latex`)
- **Parser (Rust):** Custom lexer: `\section`, `\subsection`, `\chapter` → heading nodes; `\begin{equation}` → `formula`; `lstlisting` / `verbatim` → `code`; `\begin{tabular}` → `table`.
- **Math:** Inline `$...$` and display `$$...$$` preserved as `formula` nodes with raw LaTeX as `text`.
- **Bibliography:** `\cite` references linked as `link` nodes pointing to bib keys; not included in chunk content.

---

## Observability

### Extended `virage chunks report`

```
📊 Chunk Cohesion Report (4821 total chunks)
────────────────────────────────────────────────────────────
  Format        Count   Avg tokens  Breadcrumb%  Page cov%  Cohesion
  ──────────    ─────   ──────────  ───────────  ─────────  ────────
  md            1204    312         98.2%        —          91.4%
  code-ast       987    481         74.1%        —          88.7%
  pdf           2630    498         82.3%        100%       79.2%
────────────────────────────────────────────────────────────
```

New columns:
- **Breadcrumb%**: fraction of chunks with non-empty `breadcrumb`
- **Page cov%**: fraction of chunks with `pageStart` set (paginated formats only)

### CI Gate Extension (`suite.json`)

```json
{
  "ciGate": {
    "mrr": 0.35,
    "chunkQuality": {
      "minBreadcrumbCoverage": 0.80,
      "minSemanticCoherence": 0.75
    }
  }
}
```

### Telemetry (implicit tier)

New fields added to `TelemetrySearchRow`:

```typescript
chunkFormat?: string;
chunkStrategy?: string;
avgTokensPerChunk?: number;
breadcrumbDepth?: number;
```

---

## Phased Roadmap

### Phase 1 — Foundation (CE, TypeScript only)

- [ ] Add `DocNode`, `DocNodeAttrs`, `ChunkMeta` types to `virage-core`
- [ ] Create `virage-chunker-ce-ast`: generalized ViDoc walker, `maxTokens` windowing, `ChunkMeta` emission
- [ ] Migrate `virage-chunker-ce-md`: markdown → ViDoc (remark-based), frontmatter, full breadcrumb
- [ ] Extend `strategy-registry.ts`: add `"package"` strategy type calling `importPackage()`
- [ ] Update `virage chunks report`: breadcrumb coverage column, per-format breakdown
- [ ] Update `virage init`: add PDF/DOCX to format detection and chunker selection wizard
- [ ] Conformance shim: shape `virage-code-chunk-chunker` output to `ChunkMeta`

### Phase 2 — Rust Core (CE native)

- [ ] Scaffold `Cargo.toml` workspace at repo root; add napi-rs CI workflow template
- [ ] `virage-chunker-ce-pdf`: lopdf + heading heuristics + page tracking
- [ ] `virage-chunker-ce-docx`: docx-rs + OOXML structure, tables, images
- [ ] `virage-chunker-ce-latex`: custom lexer, math nodes, `\section`/`\chapter` hierarchy
- [ ] Per-format benchmark: index time + chunk quality vs JS alternatives

### Phase 3 & 4 — EE

EE formats (XLSX, PPTX, HTML, ePub, RST) and language detection are in the `vivantel/virage-chunkers-ee` repo. See `docs/EE_CHUNKING_ROADMAP.md` in that repo for the full roadmap.

---

## Migration from Current System

Existing `virage.config.json` files using `"strategy": "markdownHeaders"` or `"strategy": "codeChunkAst"` continue to work without change. The new `ChunkMeta` fields appear on newly indexed chunks; existing chunks in the SQLite store retain their original `metadata_json` and are re-indexed only on file change.

**Recommended migration path:**

1. Install `@vivantel/virage-chunker-ce-md` and add `"strategy": "package"` entry for markdown files
2. Run `virage index --force` to re-chunk all markdown files with richer metadata
3. Verify with `virage chunks report` — `Breadcrumb%` should reach ≥ 95% for markdown
4. Gradually add PDF/DOCX chunkers as formats are needed

---

## Open Questions

- **OCR for image-based PDFs**: Should `virage-chunker-ce-pdf` integrate an external OCR service (Tesseract) when text extraction yields < N characters per page? Candidate for EE or a separate opt-in plugin.
- **Overlap byte offsets**: Should `ChunkMeta` carry `overlapStart`/`overlapEnd` to mark which bytes are repeated overlap vs unique content? Useful for deduplication and retrieval scoring.
- **Cache invalidation on `strategyOptions` change**: When only `maxTokens` changes, content hashes remain valid but chunk boundaries shift. Should the strategy identifier include options so the cache is correctly busted?
