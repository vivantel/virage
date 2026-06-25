---
id: ADR-001
title: ESM-first TypeScript with NodeNext module resolution
status: Accepted
date: 2026-05-31
---

## Context

The library targets Node.js ≥ 18, which ships native ESM support. Consumers of RAG tooling are increasingly ESM-first themselves. CJS dual-publishing adds build complexity and frequently causes subtle interop bugs with dynamic `import()`.

## Decision

Ship as a pure ESM package (`"type": "module"` in `package.json`, `"module": "NodeNext"` in `tsconfig.json`). All internal imports use explicit `.js` extensions as required by NodeNext resolution (e.g. `from "./git-tracker.js"` even though source files are `.ts`).

## Consequences

- **+** Native ESM consumers get zero-friction integration.
- **+** No dual-build tooling to maintain.
- **−** CJS consumers (`require()`) cannot use the package without a wrapper.
- **−** All contributors must remember the `.js` extension convention on new imports.

## Alternatives Considered

[Not documented in original]

## References

[Not documented in original]
