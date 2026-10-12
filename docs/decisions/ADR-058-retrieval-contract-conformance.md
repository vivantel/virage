---
id: ADR-058
title: Retrieval contract v0 conformance mode
status: Accepted
date: 2026-10-12
related: [ADR-051, ADR-053]
---

## Context

A host tool can own the agent hook and MCP entry that put retrieved chunks into a prompt. It then
expects a retrieval tool to meet a small, tool-neutral contract (`contractVersion` 0) made of
three project files and a loopback JSON endpoint:

| Part | File | Owner |
| ---- | ---- | ----- |
| Index policy | `.go-getter/retrieval/policy.json` | host (virage only reads it) |
| Declaration | `.go-getter/retrieval/virage.json` | virage |
| Endpoint discovery | `.go-getter/state/retrieval/virage.endpoint.json` | virage, while the endpoint runs |

Virage today registers its own MCP server in `.mcp.json` and a `UserPromptSubmit` hook in
`.claude/settings.json`, so it cannot satisfy the contract by default. Existing users depend on that
behaviour, so it must not change unless they opt in.

## Decision

Add a **conformance mode**. It is selected by `retrieval.conformance` in `virage.config.json`:

- `true` / `false` — explicit, always wins.
- absent — the mode is on if `.go-getter/retrieval/policy.json` exists, off otherwise.

Without a policy file and without the flag, behaviour is exactly as before.

In conformance mode:

- agent plugins register no MCP entry and no hook: `@vivantel/virage-agent-claude` skips the
  `.mcp.json` / `.claude/settings.json` writes, and `BaseAgentPlugin` does not copy plugin-config
  files that register a hook or MCP server (`hooks.json`, `.mcp.json`, `.claude-plugin/plugin.json`)
  or slash commands that only work with the MCP server;
- `virage init` and `virage update` write the declaration with `registersHostConfig: false`. The
  Rust binary and the TypeScript CLI each write it, with their own version as `toolVersion`;
- later changes (policy gate, secret scan, query endpoint) build on this mode: see the follow-up
  ADR sections appended below as they land.

`preIndexSecretScan` is reported as `false` until the pre-index scan exists, and flips to `true`
in the same change that adds the scan.

## Consequences

- One new optional config field (`retrieval.conformance`); non-breaking, so
  `VIRAGE_CONFIG_SCHEMA_VERSION` does not change.
- Two small implementations of the same helper (Rust: `virage_engine::retrieval`, TypeScript:
  `@vivantel/virage-core` and, dependency-free, `@vivantel/virage-agent-core`) because the Rust
  binary and the TypeScript CLI both run `init` and `update`.
- Entries older versions already wrote are not removed by `init`/`update`; `virage uninstall`
  removes them.

## Addendum: index policy (retrieval contract v0, part a)

Before every index run and every query virage reads `.go-getter/retrieval/policy.json`
(`virage_engine::retrieval::policy`, `@vivantel/virage-core` `retrieval-policy.ts`):

- `ignore` is converted from gitignore syntax to glob patterns and appended to the config's global
  `ignore`, so every fileSet inherits it. The same globs filter query results (over-fetching 4x so
  a page can still fill). A hit with no source path cannot be checked and is dropped.
- An embedder kind not listed in `embedders` is refused. Only known local packages are `local`;
  everything else is `hosted`.
- Fail closed: a present-but-bad file always refuses; a missing file refuses in conformance mode.
  A present file is enforced even when `retrieval.conformance` is `false`: that flag controls host
  registration, not whether the host's restrictions apply.
- Gates: `virage index` (and each `--watch` re-index), `virage query`, `virage query-serve`
  (per query), `virage serve` (startup + per search), and in the TypeScript CLI `loadConfig`
  (before any provider is created) plus the `query` command's result filter.
- Not gated: diagnostic commands that search to measure quality (`virage quality`, `store perf`).
