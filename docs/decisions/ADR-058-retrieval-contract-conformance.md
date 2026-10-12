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
