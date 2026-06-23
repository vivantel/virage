# Chunking System Roadmap

## Overview

The current chunking system handles TypeScript/JavaScript/Python/Go/Java/Rust source code via tree-sitter AST (`virage-code-chunk-chunker`) and Markdown via heading-split (`markdownHeaders`). Both strategies produce opaque `metadata: Record<string, unknown>` with no standardised shape, no breadcrumb path, no byte offsets, and no file-level provenance.

This roadmap defines a new, fully extensible chunking platform with three headline improvements:

1. **Format coverage** — structured document formats (PDF, DOCX, XLSX, LaTeX, ePub, …) alongside existing code/text
2. **Parse performance** — Rust native parsers exposed to Node.js via **napi-rs**, the same model used by `better-sqlite3` which already ships in `virage-core`
3. **Rich adaptive metadata** — every chunk carries a standardised `ChunkMeta` object: hierarchy breadcrumb, byte/line/page offsets, file-level provenance, BCP-47 language tag, and observability signals

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
- Pure TypeScript (pdf.js, mammoth, xlsx.js) — zero native deps, fastest to ship, but pdf.js in particular is single-threaded and slow on large corpora; kept as a TS-first fallback for Phase 1 (no Rust yet) and as a graceful degradation layer

### D-2 · CE/EE split: private npm registry

**Decision:** Community Edition (CE) chunkers live in this monorepo and are published to the public npm registry. Enterprise Edition (EE) chunkers live in the separate private repository `vivantel/virage-chunkers-ee` and are published to GitHub Packages under the `@vivantel` scope, gated by `VIRAGE_EE_TOKEN`.

**Rationale:**
- Cleanest IP boundary — EE source code never ships to CE users
- Leverages `importPackage()`'s five-tier resolution (already used for embedders/stores), so EE chunkers install and load identically to CE ones; no special loader code needed
- Customers add one `.npmrc` stanza and run `npm install @vivantel/virage-chunker-ee-xlsx`; no repo access or git subtree ceremony required

**Alternatives considered:**
- Git subtree into this repo (`packages/virage-chunker-ee-*/`) — keeps one build pipeline but makes EE source visible to anyone with access to this repo; subtree hygiene adds CI complexity
- Feature flags / license key in same codebase — simplest distribution but ships proprietary algorithms to all CE users

### D-3 · Unified AST: custom ViDoc AST

**Decision:** A new `DocNode` tree (the "ViDoc AST") is defined in `virage-core` as the internal representation shared by all structured-document chunkers. Rust parsers serialize it as JSON across the napi-rs boundary; the TypeScript chunking layer deserializes and walks it.

**Rationale:**
- Full control over the node schema: every field is designed for RAG use (breadcrumb, byte offsets, page number, semantic role, language tag)
- No dependency on Unist's string-typed `type` system or Pandoc's binary requirement
- Can map to/from Unist nodes if remark plugin interop is desired in future

**Alternatives considered:**
- Unist-compatible (mdast superset) — excellent ecosystem but spreadsheet cells, LaTeX math environments, and PDF structure maps awkwardly onto Unist's `node.data.virage` extension pattern
- Pandoc JSON AST — handles 40+ formats but requires the `pandoc` binary on PATH, and Pandoc's AST is not optimised for chunk metadata

---

## Plugin Naming Convention

```
@vivantel/virage-chunker-{edition}-{format}
```

- `edition` is `ce` (Community Edition, public npm) or `ee` (Enterprise Edition, private registry)
- `format` is a short, lowercase identifier for the file format or chunking approach

### CE Packages (this monorepo)

| Package | Format | Rust crate(s) | Status |
|---------|--------|---------------|--------|
| `@vivantel/virage-chunker-ce-md` | Markdown / MDX | — (pure TS, pulldown-cmark optional) | Phase 1 |
| `@vivantel/virage-chunker-ce-ast` | Generalized ViDoc AST walker | — (pure TS) | Phase 1 |
| `@vivantel/virage-chunker-ce-pdf` | PDF (text layer extraction) | `lopdf`, `pdf-extract` | Phase 2 |
| `@vivantel/virage-chunker-ce-docx` | DOCX / OXML | `docx-rs` | Phase 2 |
| `@vivantel/virage-chunker-ce-latex` | LaTeX | custom lexer | Phase 2 |

### EE Packages (`vivantel/virage-chunkers-ee`)

| Package | Format | Rust crate(s) | Status |
|---------|--------|---------------|--------|
| `@vivantel/virage-chunker-ee-xlsx` | Excel / XLSX / XLS | `calamine` | Phase 3 |
| `@vivantel/virage-chunker-ee-pptx` | PowerPoint PPTX | custom OOXML | Phase 3 |
| `@vivantel/virage-chunker-ee-html` | HTML (semantic sections) | `scraper` | Phase 3 |
| `@vivantel/virage-chunker-ee-epub` | ePub 2/3 | `epub-builder` | Phase 4 |
| `@vivantel/virage-chunker-ee-rst` | reStructuredText | `rst-parser` | Phase 4 |

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
  /** Byte offset of node's first byte in the source file */
  byteStart: number;
  /** Byte offset one past node's last byte */
  byteEnd: number;
  /** 1-based line number (text formats) */
  lineStart?: number;
  lineEnd?: number;
  /** 1-based page number (paginated formats: PDF, DOCX) */
  pageNumber?: number;

  // ── Language ──────────────────────────────────────────────────────────
  /** BCP-47 language tag for the node's content, e.g. 'en', 'de', 'zh-Hans' */
  lang?: string;
  /** Programming language for code nodes, e.g. 'python', 'rust' */
  codeLanguage?: string;

  // ── Tabular ───────────────────────────────────────────────────────────
  tableRow?: number;
  tableCol?: number;
  isHeader?: boolean;   // true for header rows/cells

  // ── List ──────────────────────────────────────────────────────────────
  listDepth?: number;
  ordered?: boolean;

  // ── Format ────────────────────────────────────────────────────────────
  sourceFormat?: "md" | "pdf" | "docx" | "latex" | "xlsx" | "html" | "epub" | "rst" | string;
}

export interface DocNode {
  type: DocNodeType;
  /** Immediate child nodes (structural nodes) */
  children?: DocNode[];
  /** Leaf text content (leaf nodes: paragraph, heading text, cell text, …) */
  text?: string;
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

This keeps the Rust codebase decoupled from TypeScript type evolution — JSON is the stable interface; type assertions live in TypeScript.

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
  /**
   * Full path from document root to this chunk's nearest ancestor heading.
   * e.g. ['API Reference', 'Authentication', 'OAuth 2.0']
   */
  breadcrumb: string[];
  sectionTitle?: string;     // text of the nearest ancestor heading
  headingLevel?: number;     // heading level (1–6) of that heading
  /**
   * Top-level section titles in the document — provides document outline context
   * so an LLM reading this chunk knows what other sections exist.
   */
  documentOutline?: string[];

  // ── Language ──────────────────────────────────────────────────────────
  lang?: string;             // BCP-47, e.g. 'en', 'de', 'zh-Hans'
  codeLanguage?: string;     // for code blocks

  // ── Chunker identity ──────────────────────────────────────────────────
  strategy: string;          // e.g. '@vivantel/virage-chunker-ce-pdf@1.0.0'
  chunkIndex: number;        // 0-based position within this file
  totalChunks: number;       // total chunks produced from this file

  // ── Observability ─────────────────────────────────────────────────────
  estimatedTokens: number;   // approximate token count (chars / 4)
  qualityScore?: number;     // composite 0–1: semantic coherence × info density
  truncated?: boolean;       // true if content was hard-cut at maxTokens
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

This package contains the **shared TypeScript chunking strategy** used by all structured-document parsers. Format-specific parsers (CE and EE) produce a `DocNode` tree; this strategy walks it and emits `Chunk[]`.

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
├── package.json                  # optionalDependencies per platform
├── npm/
│   ├── linux-x64-gnu/            # platform stub packages
│   ├── linux-arm64-gnu/
│   ├── darwin-x64/
│   ├── darwin-arm64/
│   └── win32-x64-msvc/
└── __test__/
    └── pdf.spec.ts               # Vitest + fixture PDFs
```

### CI Platform Matrix (GitHub Actions)

```yaml
# .github/workflows/build-chunker-ce-pdf.yml
strategy:
  matrix:
    include:
      - os: ubuntu-latest  target: x86_64-unknown-linux-gnu
      - os: ubuntu-latest  target: aarch64-unknown-linux-gnu
      - os: macos-latest   target: x86_64-apple-darwin
      - os: macos-latest   target: aarch64-apple-darwin
      - os: windows-latest target: x86_64-pc-windows-msvc
```

Each job runs `napi build --release --target <target>`, uploads the `.node` file, and the publish step bundles them into the per-platform optional packages.

### package.json Pattern

```json
{
  "name": "@vivantel/virage-chunker-ce-pdf",
  "version": "1.0.0",
  "main": "src-ts/index.js",
  "exports": { ".": { "import": "./src-ts/index.js", "types": "./src-ts/index.d.ts" } },
  "optionalDependencies": {
    "@vivantel/virage-chunker-ce-pdf-linux-x64-gnu": "1.0.0",
    "@vivantel/virage-chunker-ce-pdf-linux-arm64-gnu": "1.0.0",
    "@vivantel/virage-chunker-ce-pdf-darwin-x64": "1.0.0",
    "@vivantel/virage-chunker-ce-pdf-darwin-arm64": "1.0.0",
    "@vivantel/virage-chunker-ce-pdf-win32-x64-msvc": "1.0.0"
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

### Example Config (CE PDF + EE XLSX)

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
      },
      {
        "name": "spreadsheets",
        "patterns": ["**/*.xlsx", "**/*.xls"],
        "strategy": "package",
        "package": "@vivantel/virage-chunker-ee-xlsx",
        "strategyOptions": { "maxTokens": 256, "includeFormulas": false, "headerRows": 1 }
      }
    ]
  }
}
```

---

## CE/EE Registry Setup

### CE (public npm — no token needed)

```bash
npm install @vivantel/virage-chunker-ce-pdf
```

### EE (GitHub Packages — requires token)

```ini
# .npmrc (project root or ~/)
@vivantel:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${VIRAGE_EE_TOKEN}
```

```bash
npm install @vivantel/virage-chunker-ee-xlsx
```

The EE repo (`vivantel/virage-chunkers-ee`) is a standalone monorepo with its own npm workspaces, napi-rs CI pipeline, and release-please manifest. It shares the `ChunkMeta` and `DocNode` interfaces by depending on `@vivantel/virage-core` as a peer dependency — the only coupling point.

---

## Format-Specific Design Notes

### Markdown (`virage-chunker-ce-md`)
- **Parser:** Pure TypeScript — `unified` + `remark-parse` produces mdast (Unist AST)
- **Strategy:** Walk mdast, map to DocNode (heading → `heading` node, paragraph → `paragraph`, fenced code → `code` with `codeLanguage`). Delegate to `virage-chunker-ce-ast` walker.
- **Breadcrumb:** Built from ancestor `heading` nodes in mdast. All existing `markdownHeaders` users are migrated automatically with the same split boundaries but richer metadata.
- **Extra:** Front-matter (`---`) fields are extracted as `metadata` DocNode attrs (title, author, date, tags → appended to `documentOutline`).

### Code AST (`virage-chunker-ce-ast` via `virage-code-chunk-chunker`)
- **Status quo preserved:** `virage-code-chunk-chunker` continues to use `code-chunk` (tree-sitter). The only change is that its `Chunk.metadata` is shaped to conform to `ChunkMeta`.
- **Breadcrumb:** Class → method path from AST scope chain, e.g. `['MyService', 'processRequest']`.
- **No DocNode intermediary:** Code AST bypasses the ViDoc AST and populates `ChunkMeta` directly — tree-sitter already provides the structure.

### PDF (`virage-chunker-ce-pdf`)
- **Parser (Rust):** `lopdf` for stream decoding; heuristic heading detection (font size > body average → heading, or bookmarks/outlines from PDF structure tree).
- **Page numbers:** Extracted from `lopdf` page iterator → `pageStart`/`pageEnd` on each chunk.
- **Limitations:** Scanned/image-only PDFs produce no text; chunker logs a warning and emits zero chunks for those pages (future: OCR integration point).

### DOCX (`virage-chunker-ce-docx`)
- **Parser (Rust):** `docx-rs` reads OOXML ZIP; walks `w:body` elements. `w:style` attributes identify Heading1–Heading6 → `heading` DocNodes. Tables → `table` DocNodes with cell-level text.
- **Tracked changes:** Accepted-only mode (deletions omitted, insertions included).
- **Images:** `image` DocNode emitted with `attrs.role = 'figure'`; `alt` text from `descr` attribute used as leaf `text` if present.

### LaTeX (`virage-chunker-ce-latex`)
- **Parser (Rust):** Custom lexer: `\section`, `\subsection`, `\chapter` → heading nodes; `\begin{equation}` → `formula`; `lstlisting` / `verbatim` → `code`; `\begin{tabular}` → `table`.
- **Math:** Inline `$...$` and display `$$...$$` blocks preserved as `formula` nodes with raw LaTeX as `text`. Enables future math-aware embedding.
- **Bibliography:** `\cite` references linked as `link` nodes pointing to bib keys; not included in chunk content.

### XLSX (`virage-chunker-ee-xlsx`)
- **Parser (Rust):** `calamine` reads all sheets. Each sheet becomes a `section` node named after the tab. Header row (first non-empty row or configured `headerRows`) becomes column labels prepended to each data chunk.
- **Chunking strategy:** Group rows into windows of `maxTokens` tokens; include column headers in every chunk for context.
- **Formulas:** Optional — include computed values only (default) or raw formula strings (`includeFormulas: true`).
- **Breadcrumb:** `[filename, sheetName]` e.g. `['budget-2024.xlsx', 'Q3 Actuals']`.

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
- **Breadcrumb%**: fraction of chunks with non-empty `breadcrumb` array
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

New fields added to `TelemetrySearchRow` (no user-identifiable data):

```typescript
chunkFormat?: string;      // 'md' | 'pdf' | 'docx' | ...
chunkStrategy?: string;    // package name of the chunker
avgTokensPerChunk?: number;
breadcrumbDepth?: number;  // average breadcrumb array length
```

---

## Phased Roadmap

### Phase 1 — Foundation (CE, TypeScript only)

**Goal:** Standardised metadata and config-schema extension; no Rust.

- [ ] Add `DocNode`, `DocNodeAttrs`, `ChunkMeta` types to `virage-core`
- [ ] Create `virage-chunker-ce-ast`: generalized ViDoc walker, `maxTokens` windowing, `ChunkMeta` emission
- [ ] Migrate `virage-chunker-ce-md`: markdown → ViDoc (remark-based), frontmatter, full breadcrumb
- [ ] Extend `strategy-registry.ts`: add `"package"` strategy type calling `importPackage()`
- [ ] Update `virage-chunks-report`: breadcrumb coverage column, per-format breakdown
- [ ] Update `virage init`: add PDF/DOCX to format detection and chunker selection wizard
- [ ] Conformance shim: shape `virage-code-chunk-chunker` output to `ChunkMeta`

### Phase 2 — Rust Core (CE native)

**Goal:** Rust parsers for the three largest unserved formats.

- [ ] Scaffold `Cargo.toml` workspace at repo root; add napi-rs CI workflow template
- [ ] `virage-chunker-ce-pdf`: lopdf + heading heuristics + page tracking
- [ ] `virage-chunker-ce-docx`: docx-rs + OOXML structure, tables, images
- [ ] `virage-chunker-ce-latex`: custom lexer, math nodes, `\section`/`\chapter` hierarchy
- [ ] Per-format benchmark: index time + chunk quality vs JS alternatives

### Phase 3 — EE Launch

**Goal:** Private registry infrastructure and first EE formats.

- [ ] Set up `vivantel/virage-chunkers-ee` repo with shared CI template
- [ ] GitHub Packages publishing pipeline + `VIRAGE_EE_TOKEN` docs
- [ ] `virage-chunker-ee-xlsx`: calamine, sheet tabs, header-row context
- [ ] `virage-chunker-ee-pptx`: slide-level sections, speaker notes, alt text
- [ ] `virage-chunker-ee-html`: semantic HTML5 sections (`<article>`, `<section>`, `<nav>`)
- [ ] `virage init` EE-aware: detect EE token, prompt for XLSX/PPTX chunkers

### Phase 4 — Advanced

**Goal:** Language detection, remaining formats, eval coverage.

- [ ] Language detection via `lingua-rs` napi-rs binding → auto BCP-47 lang tags
- [ ] `virage-chunker-ee-epub`: EPUB 2/3, NCX/NAV TOC extraction
- [ ] `virage-chunker-ee-rst`: reStructuredText via Sphinx-compatible parser
- [ ] Cross-format eval: add PDF, DOCX, XLSX fixtures to `eval/golden-dataset.json`
- [ ] WASM fallback builds for `virage-chunker-ce-pdf` and `virage-chunker-ce-docx`
- [ ] `virage chunks diff` command: compare chunk quality before/after strategy change

---

## Migration from Current System

Existing `virage.config.json` files using `"strategy": "markdownHeaders"` or `"strategy": "codeChunkAst"` continue to work without change (backward-compatible). The new `ChunkMeta` fields (`breadcrumb`, `byteStart`, `estimatedTokens`, …) appear on newly indexed chunks; existing chunks in the SQLite store retain their original `metadata_json` and are re-indexed only on file change (normal incremental behaviour).

**Recommended migration path:**

1. Install `@vivantel/virage-chunker-ce-md` and add `"strategy": "package"` entry for markdown files to get breadcrumb metadata
2. Run `virage index --force` to re-chunk all markdown files with the new chunker
3. Verify with `virage chunks report` — `Breadcrumb%` should reach ≥ 95% for markdown
4. Gradually add PDF/DOCX chunkers as formats are needed

---

## Open Questions

- **OCR for image-based PDFs**: Should `virage-chunker-ce-pdf` call an external OCR service (Tesseract, AWS Textract) when text extraction yields < N characters per page? If so, this is an EE feature or a separate plugin.
- **Overlap between chunks**: The current token chunker supports `overlap` (repeated suffix/prefix lines). Should `ChunkMeta` carry `overlapStart`/`overlapEnd` offsets to mark which bytes are overlap vs unique content? Useful for deduplication and retrieval scoring.
- **Chunk-level embedding cache invalidation**: When only `strategyOptions` change (e.g., `maxTokens`), existing content hashes remain valid but chunk boundaries shift. Should the strategy name include options in its identifier so the cache is correctly busted?
