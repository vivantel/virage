---
id: ADR-030
title: Semver ranges in peerDependencies for inter-package virage dependencies
status: Accepted
date: 2026-06-17
related: [ADR-008]
---

## Context

Virage is a monorepo of 20+ packages that can be mixed and matched by consumers. Currently, published packages pin their inter-package dependencies to exact versions in `dependencies`, which means consumers cannot adopt a patched version of one package without upgrading the whole ecosystem.

## Decision

**Published packages that consume other virage packages** should declare those virage packages as `peerDependencies` with a semver range, and keep an exact pinned version only in `devDependencies` (used for local monorepo builds and CI):

```jsonc
// e.g., in virage-embedder-openai/package.json
{
  "peerDependencies": {
    "@vivantel/virage-core": ">=0.2.28 <0.3.0"
  },
  "devDependencies": {
    "@vivantel/virage-core": "0.2.28"   // exact, for monorepo builds
  }
}
```

The range constraint `>=X.Y.Z <X.(Y+1).0` signals: "any patch release in this minor series is compatible." Once the project reaches 1.0, switch to `^X.Y.Z`.

**`virage-cli` is the exception** — it is a tool, not a consumed library. It keeps exact `dependencies` because it is always installed at a fixed version and does not participate in downstream resolution.

**Changesets vs Release Please:** Changesets are not adopted. Release Please already automates semver versioning via conventional commits and handles coordinated bumps across the monorepo.

## Consequences

- **+** Consumers can adopt a patched version of one virage package without upgrading the full ecosystem.
- **+** `npm install` resolves the constraint declaratively; no runtime version-checking code needed.
- **+** Aligns with standard npm library conventions.
- **−** Minor coordination cost: peerDep ranges must be updated when a package introduces a breaking change.
- **−** `npm install` will warn about unmet peer dependencies if a consumer installs an incompatible version — this is intentional and informative.

## Alternatives Considered

Changesets for coordinated version management was evaluated and rejected because Release Please already handles this without requiring contributors to run extra manual steps.

## References

- [ADR-008](./ADR-008-monorepo-independent-versioning.md) — monorepo structure that makes this peerDep strategy necessary
- [ADR-016](./ADR-016-automated-releases-release-please.md) — release-please automation
