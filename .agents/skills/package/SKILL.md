---
name: package
description: Add, update, develop, sync, and test packages in the Virage monorepo.
license: MIT
metadata:
  author: vivantel-team
  version: "1.0.0"
---

# Skill: Package Lifecycle

**Purpose:** Add, update, develop, sync, and test packages in the monorepo.

---

## When to use this skill

- Adding a new package to the monorepo
- Updating dependencies or publishing config in an existing package
- Building, type-checking, or running tests for a specific package
- Syncing shared tsconfig/eslint config across packages

---

## Context checklist

```
[ ] Read docs/ai/INDEX.md cross-cutting rules (imports, commit style, pre-commit hook)
[ ] Identify which operation: Add / Update / Develop / Sync / Test
[ ] Before committing: npm run fix && npm run lint && npm run type-check:ci (see .agents/skills/code-guardian/SKILL.md)
```

---

## Decision tree

```
What are you doing?
├── New package              → §Add
├── Dep or version change    → §Update
├── Writing + building code  → §Develop
├── Syncing shared config    → §Sync
└── Running tests only       → §Test (or load .agents/skills/qa/SKILL.md)
```

---

## Current State — Package inventory

| Package                      | Published    | Purpose                                                                   |
| ---------------------------- | ------------ | ------------------------------------------------------------------------- |
| virage-core                  | yes          | Pipeline engine, interfaces, strategies, eval — no CLI deps               |
| virage-cli                   | yes          | `virage` binary + all CLI commands; embeds dashboard at build time        |
| virage-dashboard             | yes          | React + Vite dashboard served by `virage dashboard`; publishes `dist/`    |
| virage-strategies            | yes          | Re-export of built-in chunk strategies as standalone install              |
| virage-embedder-openai       | yes          | OpenAI embeddings + semantic cache + LLM judge                            |
| virage-embedder-transformers | yes          | HuggingFace Transformers (local inference)                                |
| virage-embedder-fastembed    | yes          | FastEmbed ONNX (local inference)                                          |
| virage-store-postgres        | yes          | pgvector vector store                                                     |
| virage-store-qdrant          | yes          | Qdrant vector store (local or cloud)                                      |
| virage-store-lancedb         | yes          | LanceDB embedded vector store (file-based)                                |
| virage-store-chromadb        | yes          | ChromaDB vector store (local or hosted)                                   |
| virage-mcp                   | yes          | MCP stdio server — search and inspect any virage index from AI assistants |
| virage-code-chunk-chunker    | yes          | AST-aware code chunker using code-chunk/tree-sitter (TS, JS, Python, Rust, Go, Java) |
| virage-store-test            | no (private) | File-backed mock VectorStore for acceptance testing                       |

> **Keep this table current.** After adding or removing a package, update this snapshot, then run `.agents/skills/overseer/SKILL.md`.

---

## Published package required fields

Every published `package.json` must have:

| Field            | Value                                                             |
| ---------------- | ----------------------------------------------------------------- |
| `author`         | `"Vivantel"`                                                      |
| `license`        | `"MIT"`                                                           |
| `keywords`       | RAG-related terms + package-specific terms                        |
| `repository`     | `{ "type": "git", "url": "...", "directory": "packages/<name>" }` |
| `engines`        | `{ "node": ">=18.0.0" }`                                          |
| `publishConfig`  | `{ "access": "public" }`                                          |
| `files`          | Must include `"README.md"` alongside output dir                   |
| `prepublishOnly` | At minimum `"npm run build"`                                      |

Required scripts: `build`, `type-check`, `lint`, `lint:fix`, `format`, `format:check`, `fix`.

---

## §Add — New package scaffold

1. `mkdir packages/<name>/src`
2. Create `packages/<name>/package.json` — all required fields above; set `"type": "module"`
3. Copy `tsconfig.json` from `packages/virage-store-lancedb/tsconfig.json` (NodeNext pattern, `rootDir: "./src"`, `outDir: "./dist"`)
4. Create `src/index.ts` (exports) and `README.md` (badges, description, install, usage)
5. Wire release-please (see `.agents/skills/devops/SKILL.md` §Adding a new publishable package)
6. Wire CI workflows: add path filter to `.github/workflows/ci.yaml` `filters:` block; add output + `packages+=` line to `.github/workflows/release.yaml`
6a. Add `-w packages/<name>` to the `type-check:ci` script in root `package.json`
7. Update §Current State table above
8. Update `.agents/skills/devops/SKILL.md` §Current State published packages list
9. `npm install` from repo root — links workspace and updates `package-lock.json`.  
   **STOP if this fails for any reason** (disk space, network, native build error). Do not write source files or proceed to later steps until `npm install` completes successfully and `package-lock.json` contains the new package name.  
   Stage `package-lock.json` alongside source files — a stale lock file breaks `npm ci` in CI.
9a. Verify lock file integrity: `npm ci --dry-run` from repo root must pass. If it fails, re-run `npm install` and retry. A simple `grep` is insufficient — it misses missing transitive dependency entries that will break `npm ci` in CI.
10. `npm run type-check -w @vivantel/<name>` must pass
11. `npm run build -w @vivantel/<name>` must pass
12. Run `.agents/skills/overseer/SKILL.md` reactive checklist

---

## §Update — Existing package changes

- **Dep bump**: update `package.json` → `npm install` → `npm run type-check -w @vivantel/<name>`
- **Interface change**: grep all workspace packages for the changed import before committing
- **CLI command changed**: update `docs/ai/INDEX.md` §Essential commands if the command is commonly used
- **Commit format**: `feat(<name>): ...` or `fix(<name>): ...` (drives release-please version bumps)

---

## §Develop — Build loop

```bash
npm run build -w @vivantel/<name>                        # one-shot compile
npm run type-check -w @vivantel/<name>                   # type-only (faster)
npm run build:with-dashboard -w @vivantel/virage-cli     # CLI + embedded dashboard UI
```

---

## §Sync — Shared config across packages

Items to keep consistent across all packages:

| Config                           | Expected value                         |
| -------------------------------- | -------------------------------------- |
| `tsconfig.json` module           | `"NodeNext"`                           |
| `tsconfig.json` moduleResolution | `"NodeNext"`                           |
| `tsconfig.json` target           | `"ES2022"`                             |
| ESLint config                    | Inherited from root `eslint.config.js` |
| `engines.node`                   | `">=18.0.0"`                           |

---

## §Test — Running tests

See `.agents/skills/qa/SKILL.md` for the full test strategy. Quick reference:

```bash
npm test -w @vivantel/virage-core                         # unit tests
npm run test:acceptance -w @vivantel/virage-core          # acceptance (build virage-store-test first)
npm run type-check:ci                                     # all included packages
npx vitest run src/core/git-tracker.test.ts               # single test file
```

**Type-check exclusions**: `virage-embedder-openai`, `virage-embedder-transformers`, and `virage-mcp` are excluded from `type-check:ci` due to corrupted third-party type declarations in this environment (`@modelcontextprotocol/sdk` `stdio.d.ts` is empty).
