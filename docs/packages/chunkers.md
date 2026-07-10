# Chunkers

PDF, Markdown, DOCX, LaTeX, and multi-language chunking are built into the `@vivantel/virage` binary — no separate install needed. This page covers plugin-based chunkers that extend the built-in set.

## Quick reference

| Package | Key | Handles | Engine |
|---|---|---|---|
| `@vivantel/virage-chunker-ce-ts` | `ce-ts` | `.ts`, `.tsx`, `.js`, `.jsx` | TypeScript AST |
| `@vivantel/virage-chunker-ce-ast` | `ce-ast` | ViDoc AST walk | (base, no input) |

---

## `@vivantel/virage-chunker-ce-ts`

Pure TypeScript AST chunker — no native binary needed. Targets `.ts`, `.tsx`, `.js`, `.jsx` using the TypeScript compiler API.

**Patterns:** `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`

**Difference from built-in `lang`:** ce-ts is available without Rust/Cargo; the built-in `lang` chunker produces higher-quality section boundaries for TypeScript and should be preferred when using `@vivantel/virage`.

---

## `@vivantel/virage-chunker-ce-ast`

Shared ViDoc AST walker used internally by all other CE chunkers. Not typically used directly in config — included automatically by other chunker packages.

---

## Config reference

Configure chunkers per file set. Each entry in `chunkers` is a `PluginRef` — specify `builtin` for built-in chunkers or `package` for npm/WASM plugins:

```json
{
  "fileSets": [
    {
      "name": "docs",
      "include": ["docs/**/*.{md,mdx}"],
      "chunkers": [{ "builtin": "md" }]
    },
    {
      "name": "code",
      "include": ["src/**/*.{rs,py,go,ts,tsx}"],
      "chunkers": [{ "builtin": "lang" }]
    }
  ]
}
```

Built-in chunker keys:

| `builtin` key | Aliases | Handles |
|---|---|---|
| `md` | `markdown` | `.md`, `.mdx` — Markdown / MDX |
| `pdf` | | `.pdf` — text layer extraction |
| `docx` | `word` | `.docx` — Word documents |
| `latex` | `tex` | `.tex` — LaTeX |
| `lang` | `code` | `.rs`, `.py`, `.ts`, `.tsx`, `.js`, `.jsx`, `.go`, `.java`, `.c`, `.cpp` |

WASM plugin example:

```json
{ "plugin": "file:.virage/plugins/my-chunker.wasm", "include": ["**/*.xyz"] }
```

`PluginRef` fields:

| Field | Type | Description |
|---|---|---|
| `builtin` | `string` | Built-in chunker key (see table above). Mutually exclusive with `package`. |
| `package` | `string` | Explicit npm package name or WASM plugin path. Mutually exclusive with `builtin`. |
| `plugin` | `string` | Path to a WASM plugin (alternative form of `package` for local .wasm files) |
| `options` | `object` | Plugin-specific options; typed and validated per plugin |
