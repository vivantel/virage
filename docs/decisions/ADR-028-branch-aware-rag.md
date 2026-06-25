---
id: ADR-028
title: Branch-aware RAG via metadata tagging, per-file dirty detection, and search command
status: Accepted
date: 2026-06-15
related: [ADR-004]
---

## Context

The RAG pipeline stored all chunks in a single `.virage/virage.db` + vector store with no branch awareness. Switching branches could surface stale results from files that differed between branches. Additionally, the `GitTracker` used a global dirty flag — if any file in the working tree was uncommitted, every tracked file was appended `-dirty` and re-indexed on the next run, causing unnecessary re-embedding of files that were actually clean.

The existing `mcp__virage__search` reference in `plugin-config/commands/rag.md` pointed to an MCP tool that did not exist, making the `/rag` slash command non-functional.

## Decision

1. **Single DB with branch metadata tagging.** At `virage index` time, `GitTracker.getCurrentBranch()` detects the current branch. The orchestrator injects `{ branch: "<name>" }` into each chunk's `metadata` field. At query time, an optional `filter: { branch }` narrows results via post-filter on the parsed `metadata_json`.

2. **Per-file dirty detection.** `hasUncommittedChanges()` (global `boolean`) is replaced by `getDirtyFiles()` which calls `git.status()` once and returns a `Set<string>` of modified paths. Only files present in that set receive the `-dirty` commit-hash suffix.

3. **`filter?: Record<string, unknown>` added to `SearchOptions`.** The LanceDB store fetches `topK × 4` results and applies the filter as an in-process metadata match.

4. **`virage query <text>` CLI command** outputs human-readable or `--json` results. Accepts `--top-k` and `--branch` flags.

5. **`search` MCP tool** added to `virage-agent-claude`. Spawns `virage query --json` as a subprocess using the project-local `node_modules/.bin/virage` binary. The `/rag` slash command is now functional.

6. **`virage install-hooks` command** writes idempotent `post-merge` and `post-checkout` shell scripts to `.git/hooks/`, each calling `npx virage index`.

7. **`/index` slash command** added to the Claude Code agent plugin.

## Consequences

- **+** Branch-scoped search without re-embedding shared content.
- **+** Per-file dirty detection eliminates spurious full re-indexes from a single uncommitted file.
- **+** `/rag` command is now functional end-to-end.
- **+** `virage install-hooks` automates post-pull re-indexing.
- **−** Post-filter approach means the effective result count may be < topK when many chunks lack the branch tag. Run `virage index --force` to re-tag all chunks.
- **−** `virage query` subprocess adds ~1–2 s cold-start latency to the first MCP search call.
- **−** `virage install-hooks` installs to `.git/hooks/` which is not committed to the repo.

## Alternatives Considered

Per-branch databases were rejected because they would require re-embedding all content for every branch, defeating the delta-indexing design.

## References

- [ADR-004](./ADR-004-git-commit-hash-change-detection.md) — per-file dirty detection extends this
