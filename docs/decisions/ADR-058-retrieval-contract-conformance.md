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

`preIndexSecretScan` is `true`: the pre-index scan runs in conformance mode (see the secret-scan
addendum below).

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

## Addendum: pre-index secret scan (`preIndexSecretScan`)

In conformance mode every file is scanned before it is indexed; a file with a finding is skipped
(`virage_engine::secret_scan`, `@vivantel/virage-core` `secret-scan.ts`) and the declaration says
`preIndexSecretScan: true`.

- The scan covers the raw file bytes and the chunk text about to be embedded (text extracted from
  PDF/DOCX is not visible in the raw bytes). One finding skips the whole file.
- Rules: private-key blocks, AWS access key ids, GitHub / Slack / Google / Stripe / `sk-` API
  tokens, three-segment JWTs, and a high-entropy value (>= 3.5 bits/char, >= 16 chars) assigned to
  a secret-looking name (`password`, `secret`, `token`, `api_key`, ...), with obvious placeholders
  and env lookups excluded. It is a heuristic filter, not a guarantee.
- A finding names its kind and the file path only. The matched text is never returned, logged or
  stored.
- A skipped file is recorded as having zero chunks (so it is not rescanned on every run), and any
  chunks an earlier version of it left in the store are deleted.
- The scan only runs on files being (re)indexed. Files indexed before the scan was enabled and
  unchanged since are not rescanned: run `virage index --force` once after turning conformance
  mode on.
- Outside conformance mode nothing is scanned, so existing indexes are unchanged.

## Addendum: warm query endpoint (retrieval contract v0, part c)

`virage query-http` serves `POST /v0/query` and `GET /v0/health` on a loopback port, with a
per-start bearer token, and publishes `.go-getter/state/retrieval/virage.endpoint.json`
(`virage_engine::retrieval::{endpoint, discovery}`, `cli::query_http`).

- **Hand-rolled HTTP/1.1 on tokio.** The surface is two routes with small JSON bodies, so a
  minimal parser (header/body size limits, read timeouts, one request per connection, no chunked
  bodies) avoids adding an HTTP server dependency. The only new crate dependency is `getrandom`
  (already in the lockfile) for the 256-bit token.
- **Reuses the stdio daemon's engine.** `resolve_engine` and `run_search` are shared with
  `query-serve`, which is unchanged; the index policy is applied inside `run_search`, so results
  are filtered for every query.
- **Readiness.** The port is bound first and answers `503` until the engine is warm; the
  discovery file is written only once it is ready.
- **Lifecycle.** Not owned by a parent. It ends after `--idle-timeout` (default 600 s, minimum
  60 s) with no request in flight, or on SIGTERM/SIGINT, and a drop guard removes the discovery
  file (only while it still holds this instance's token). A second `query-http` for the same
  project detects a live endpoint through its health route and exits.
- **Response shaping.** Chunks are ordered by similarity, capped (`maxChunks` <= 20,
  `maxChars` <= 4000), truncated by characters, and the body is held to 64 KiB by dropping the
  lowest-ranked chunks. `source` is normalised to a project-relative `/` path with an optional
  `#L<start>[-L<end>]` fragment; a hit without a usable source is dropped.
- **Hardening.** Loopback peers only; `Host` must be a loopback name; constant-time token
  comparison; error bodies are fixed short messages and the server never logs request or chunk
  text.
- Only the Rust binary provides it; the TypeScript CLI has no `query-http`.
