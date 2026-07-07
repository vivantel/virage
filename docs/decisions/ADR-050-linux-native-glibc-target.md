---
id: ADR-050
title: Linux native packages built with cargo-zigbuild targeting glibc 2.17
status: Accepted
date: 2026-07-07
related: [ADR-048]
---

## Context

Native packages (`virage-embedder-onnx`, `virage-chunker-ce-*`) are built in CI with
`ubuntu-latest`, which is Ubuntu 24.04 as of mid-2025 (glibc 2.38+). The `onig_sys` crate
compiles Oniguruma C source against the runner's glibc headers. On glibc 2.38, those headers
redirect `strtol`, `strtoll`, and `strtoull` to their C23 aliases (`__isoc23_strtol` etc.) at
the preprocessor level — regardless of the `-std=` flag passed to the compiler. The resulting
`.node` binary then requires these symbols at runtime.

`__isoc23_strtol`, `__isoc23_strtoll`, and `__isoc23_strtoull` were introduced in glibc 2.38.
They are absent on Ubuntu 22.04 (glibc 2.35), RHEL 8, Debian 11, and other widely deployed
distributions. Users on those systems see a confusing "Native binary not found" error (actually
a load failure), making the embedder unusable.

**Confirmed via `nm -D`:** The published `virage-embedder-onnx-linux-x64-gnu` binary at v1.0.5
contains three undefined `@GLIBC_2.38` symbol references originating from `onig_sys`.

## Decision

All Linux x64 native builds (`x86_64-unknown-linux-gnu`) in `native-publish.yaml` use
`cargo-zigbuild` with an explicit glibc minimum version target:

```
x86_64-unknown-linux-gnu.2.17
```

`cargo-zigbuild` substitutes Zig's C compiler and bundled libc headers for the system GCC.
Zig's libc headers target the specified glibc version (2.17), which predates C23 entirely —
the `__isoc23_*` redirects do not exist in those headers. All C dependencies compiled from
source (including `onig_sys`) will use unversioned `strtol`/`strtoll`/`strtoull` symbols,
which resolve against any glibc ≥ 2.17.

glibc 2.17 ships in RHEL 7 (2013) and Ubuntu 14.04 (2014). Targeting it provides practical
compatibility with every production Linux environment that matters.

The `native-publish.yaml` CI job adds a Zig + cargo-zigbuild install step before the linux-x64
build, then copies the resulting `.so` from `target/` to `packages/$pkg/` with the `.node`
extension so the existing artifact upload and publish steps remain unchanged.

## Alternatives rejected

**Pin CI runner to `ubuntu-22.04`:** Deferred rather than solved — GitHub Actions will retire
22.04 runners, at which point this problem recurs. Also limits the runner to an older toolchain.

**`RUSTONIG_SYSTEM_LIBONIG=1`:** Uses the system `libonig.so.5` instead of compiling from
source, avoiding C23 symbols. Not viable for distributed npm binaries: requires libonig to be
pre-installed on the user's machine, which is not the case on Alpine, distroless, or minimal
CI containers.

**`CFLAGS=-std=c17`:** Ineffective. The `__isoc23_*` redirect is a glibc header macro that
fires regardless of the C standard flag.

**WASM plugin:** Eliminates glibc entirely. Rejected for `virage-embedder-onnx` because
(a) it requires rewriting ORT integration and the tokenizer pipeline, and (b) WASM SIMD is
limited to 128-bit, producing ~15–30% throughput regression on embedding inference compared to
native AVX2/AVX512. WASM remains a valid long-term architectural direction but is a separate
project, not a bugfix.

## macOS deployment target (included in same change)

Darwin builds (`aarch64-apple-darwin`) run on `macos-latest`, which may advance to newer macOS
versions over time. Without `MACOSX_DEPLOYMENT_TARGET`, the resulting binary's `LC_BUILD_VERSION`
reflects the CI runner's OS, silently requiring that version. Setting
`MACOSX_DEPLOYMENT_TARGET: "11.0"` (macOS 11 Big Sur, first Apple Silicon release) in the
build step `env` ensures the binary runs on macOS 11 and later. This is a minor CI config
fix — not a structural decision — and is recorded here for completeness.

## Consequences

- Zig is a CI build dependency for native packages (installed via `pip3 install ziglang` in
  the build step; no changes to `package.json` or `Cargo.toml`).
- The linux-x64-gnu binary is guaranteed to run on any glibc Linux ≥ 2.17.
- If the `ort` crate's `download-binaries` prebuilt also contains `@GLIBC_2.38` symbols (from
  ORT itself being compiled on Ubuntu 24.04), cargo-zigbuild will produce a link error in CI
  rather than a silent runtime failure. That would require the `ort` crate to provide a
  glibc-2.17-compatible prebuilt, or switching to `load-dynamic` with a bundled `.so`.
- Windows builds are unchanged (MSVC CRT is forwards-compatible; no action needed).
- `docs/ai/guardrails/native-publish-chain.md` is updated to document the cargo-zigbuild
  convention for linux-x64-gnu.
