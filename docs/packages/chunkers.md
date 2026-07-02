# Chunkers

CE (Community Edition) chunkers ship in the virage monorepo under `packages/virage-chunker-ce-*`.

Each chunker is a `rag-plugin` of type `"chunker"` that implements `ChunkingProvider`. Chunkers are selected per-file by their `patterns` globs and the route order in `chunking.chunkers`.

## Quick reference

| Package | Key | Handles | Engine |
|---|---|---|---|
| `@vivantel/virage-chunker-ce-md` | `ce-md` | `.md`, `.mdx` | Rust (comrak) |
| `@vivantel/virage-chunker-ce-lang` | `ce-lang` | 10 code extensions | Rust (tree-sitter) |
| `@vivantel/virage-chunker-ce-ts` | `ce-ts` | `.ts`, `.tsx`, `.js`, `.jsx` | TypeScript AST |
| `@vivantel/virage-chunker-ce-ast` | `ce-ast` | ViDoc AST walk | (base, no input) |
| `@vivantel/virage-chunker-ce-pdf` | `ce-pdf` | `.pdf` | Rust (lopdf) |
| `@vivantel/virage-chunker-ce-docx` | `ce-docx` | `.docx` | Rust (docx-rs) |
| `@vivantel/virage-chunker-ce-latex` | `ce-latex` | `.tex` | Rust (custom) |

---

## `@vivantel/virage-chunker-ce-md`

Parses Markdown and MDX into ViDoc AST via a Rust napi-rs native addon (comrak).

**Patterns:** `**/*.md`, `**/*.mdx`

**Output structure:** One `section` per heading level; heading text becomes `denseText` breadcrumb; content under each heading becomes `sparseText`. Fenced code blocks carry `codeLanguage` and `codeContent` attributes.

**Build requirement:** Native binary — runs `npm install` which downloads a pre-built binary from the npm release or builds from source via Cargo.

**Config:** No chunker-level `options`. Uses global `chunking.ignore` for skip patterns.

---

## `@vivantel/virage-chunker-ce-lang`

Multi-language code chunker using tree-sitter CST → ViDoc AST (Rust, native).

**Patterns:** `.rs`, `.py`, `.ts`, `.tsx`, `.js`, `.jsx`, `.go`, `.java`, `.c`, `.cpp`

**Output structure:** One `section` per top-level declaration (function, class, method, struct, etc.). `denseText` breadcrumb includes file path and declaration name. `sparseText` contains the source text with arrows removed.

**Build requirement:** Native binary — requires Rust toolchain and the tree-sitter grammars linked at build time.

**Notes:** C# support (`tree-sitter-c-sharp`) requires ABI 15 which is only available in tree-sitter 0.24+; the default linked grammar targets ABI ≤14.

---

## `@vivantel/virage-chunker-ce-ts`

Pure TypeScript AST chunker — no native binary needed. Targets `.ts`, `.tsx`, `.js`, `.jsx` using the TypeScript compiler API.

**Patterns:** `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`

**Difference from ce-lang:** ce-ts is available without Rust/Cargo; ce-lang produces higher-quality section boundaries for TypeScript and should be preferred when native build is available.

---

## `@vivantel/virage-chunker-ce-ast`

Shared ViDoc AST walker used internally by all other CE chunkers. Not typically used directly in config — included automatically by other chunker packages.

---

## `@vivantel/virage-chunker-ce-pdf`

Extracts text layer from PDF files via Rust (lopdf).

**Patterns:** `**/*.pdf`

**Build requirement:** Native binary.

**Notes:** Scanned PDFs (image-only) produce empty `sparseText`. OCR is not included.

---

## `@vivantel/virage-chunker-ce-docx`

Parses DOCX (Word) files via Rust (docx-rs).

**Patterns:** `**/*.docx`

**Build requirement:** Native binary.

**Output:** Headings → `section` nodes; paragraphs and tables → `sparseText`.

---

## `@vivantel/virage-chunker-ce-latex`

Parses LaTeX files using a custom Rust lexer/parser.

**Patterns:** `**/*.tex`

**Build requirement:** Native binary.

**Output:** `\section`, `\subsection` → ViDoc `section` hierarchy; `\begin{figure}`, `\begin{equation}` → child nodes with `type` attribute.

---

## Config reference

```json
{
  "chunking": {
    "ignore": ["node_modules/**", "dist/**"],
    "chunkers": [
      {
        "package": "@vivantel/virage-chunker-ce-lang",
        "include": ["src/**/*.{rs,py,go}"],
        "options": {}
      },
      {
        "package": "@vivantel/virage-chunker-ce-md",
        "include": ["docs/**/*.{md,mdx}"]
      }
    ]
  }
}
```

| Field | Type | Description |
|---|---|---|
| `package` | `string` | npm package name |
| `version` | `string` | optional semver constraint |
| `include` | `string[]` | route only these globs to this chunker |
| `ignore` | `string[]` | skip these globs within this chunker |
| `options` | `object` | passed as-is to `createChunker()` |
| `labels` | `LabelRule[]` | attach labels matching `{ match, add }` |
