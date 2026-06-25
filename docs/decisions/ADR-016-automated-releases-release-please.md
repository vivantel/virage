---
id: ADR-016
title: Automated releases via release-please + Conventional Commits + npm provenance
status: Accepted
date: 2026-05-31
related: [ADR-008]
---

## Context

Manual version bumps and CHANGELOG maintenance are error-prone. npm provenance (linking a published package to its source commit) is a supply-chain security best practice.

## Decision

- All commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, `feat!:` etc.).
- `release-please` runs in GitHub Actions manifest mode, generating version-bump PRs per package based on commit types.
- Publish uses GitHub Actions OIDC (`id-token: write`) for npm's trusted publisher mechanism, attaching a verifiable provenance attestation to every published tarball.
- `prepublishOnly` runs `build && test` as a final gate.

## Consequences

- **+** CHANGELOG and version bumps are automatic and consistent.
- **+** Each package versions independently (monorepo-safe).
- **+** npm provenance protects consumers from tampered packages.
- **−** Contributors must follow Conventional Commits; squash-merging with the wrong prefix silently delays a release.
- **−** release-please manifest mode configuration is non-trivial; it required several fixup commits to stabilize.

## Alternatives Considered

[Not documented in original]

## References

- [ADR-008](./ADR-008-monorepo-independent-versioning.md) — monorepo that makes per-package release automation necessary
