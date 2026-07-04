---
id: ADR-048
title: Native package platform support policy
status: Accepted
date: 2026-07-04
related: []
---

## Context

Native packages (napi-rs, built as platform-specific `.node` binaries) require a build matrix
covering every target platform. Not all platforms are feasible for every package:

- `virage-embedder-onnx` uses the `ort` crate (ONNX Runtime). ORT 2.x dropped prebuilt
  binary support for `x86_64-apple-darwin` (Intel Mac). The only macOS prebuilt path uses
  xcframework, which targets Apple Silicon (`aarch64-apple-darwin`) only.
- Intel Mac hardware was last shipped by Apple in mid-2023. Apple deprecated x86_64 in
  frameworks and tooling progressively from 2020 onward.
- `virage-chunker-ce-*` packages use tree-sitter and have no ORT dependency. They could
  theoretically build for darwin-x64, but no current release pipeline requirement exists for it.

Attempting darwin-x64 builds for `virage-embedder-onnx` caused every native-publish run to
fail because the build matrix required all platforms to succeed before the publish job ran.

## Decision

**darwin-x64 (x86_64-apple-darwin) is dropped from the native build matrix globally.**

Supported platforms for all native packages:
- `linux-x64-gnu` (x86_64-unknown-linux-gnu)
- `linux-arm64-gnu` (aarch64-unknown-linux-gnu, cross-compiled)
- `darwin-arm64` (aarch64-apple-darwin, Apple Silicon)
- `win32-x64-msvc` (x86_64-pc-windows-msvc)

darwin-x64 is removed from:
- `native-publish.yaml` build matrix
- all native package `optionalDependencies`
- all `npm/darwin-x64/` stub directories
- `release-please.json` `extra-files` entries

## Consequences

- Intel Mac users cannot use native embedder or chunker plugins. They would see "Native binary
  not found" and need to use a non-native alternative (e.g., Xenova/transformers.js embedder).
- This is the correct trade-off: Intel Macs are 3+ year old deprecated hardware; the developer
  audience virage targets upgrades hardware faster than general consumers.
- If a future native package has a specific reason to support darwin-x64 (e.g., a package with
  no ORT dependency and active Intel Mac user demand), implement a per-package platform list
  using `native-platforms` in `package.json` and a dynamic matrix in `native-publish.yaml`
  via `fromJson(needs.detect.outputs.platforms)`.

## linux-arm64 cross-compilation fix (included in same change)

The cross-compile step for `aarch64-unknown-linux-gnu` installed `gcc-aarch64-linux-gnu` but not
`g++-aarch64-linux-gnu`. ORT's prebuilt `.so` requires `libstdc++` for aarch64, which is only
provided by `g++-aarch64-linux-gnu`. Both packages are now installed together.
