# Guardrail: Native Package Publish Chain

Covers `virage-embedder-onnx` and `virage-chunker-ce-*` — any napi-rs package that ships
platform-specific `.node` binaries as optional npm stub packages.

---

## Workflow chain — invariants

```
master push
  → release.yaml        (release-please creates tag vX.Y.Z)
    → native-publish.yaml   (tag push triggers build × 5 platforms → publish → lockfile sync)
  → eval-db-release.yaml  (concurrent, separate concurrency group, excludes package-lock.json)
```

**Invariants you must never break:**

1. `native-publish.yaml` has `concurrency.cancel-in-progress: false` — serialises concurrent
   lockfile sync pushes without cancelling in-flight builds.
2. The `publish` job has `contents: write` and checks out with `RELEASE_TOKEN` — required for
   the post-publish lockfile sync git push.
3. The post-publish lockfile sync step MUST come after ALL `npm publish` calls, never before —
   the lockfile gets real `resolved`/`integrity` fields only once the stubs are on the registry.
4. `[skip ci]` in the lockfile sync commit message — prevents CI from re-triggering on the
   auto-commit.
5. `eval-db-release.yaml` path filter already excludes `package-lock.json` — do not add it
   back, it would cause an infinite loop.

---

## `patch-lockfile-stubs.cjs` — spread trap

**Never write this pattern:**

```js
const normalized = { version: depVersion, ...stubEntry };
```

When `stubEntry` already has a `version` field, the spread **overrides** `depVersion` with
the old value. `changed` becomes `true` (the version check still fires), the file is written,
but the old version is written back. `npm ci` then fails on the next run.

**Always write this instead:**

```js
const { version: _existing, ...rest } = stubEntry;
const normalized = { version: depVersion, ...rest };
```

Destructuring removes the old `version` from the spread, so `depVersion` cannot be overridden.
The same rule applies to hoisted entries.

---

## Patcher's role — resilience bridge, not permanent state

The patcher (`scripts/patch-lockfile-stubs.cjs`) is a **CI resilience bridge** that covers the
gap between a release-please merge (which bumps `optionalDependencies` in `package.json`) and
the native-publish workflow completing (which commits the canonical lockfile with real registry
data). During this window, the patcher injects placeholder `version` fields so `npm ci` can run.

After native-publish completes, the committed lockfile has real `resolved`/`integrity` entries
and the patcher is a no-op.

**Never remove these patcher call-sites:**
- `ci.yaml` — before every `npm ci` in build-and-test, rust-checks, and build-ce-native
- `native-publish.yaml` — before `npm ci` in both the build and publish jobs

Removing them breaks CI during the release window.

---

## Production feature flags — three places must stay in sync

For `virage-embedder-onnx`, the production build uses non-default Cargo features. This flag
must be declared consistently in three places:

| File | Location | Value |
|---|---|---|
| `ci.yaml` | `build-ce-native` matrix `include` | `cargo-features: "--no-default-features --features download-binaries"` |
| `native-publish.yaml` | build job bash condition | `cargo_flags="--no-default-features --features download-binaries"` |
| `.githooks/pre-push` | `prod_checks` array | `"virage-embedder-onnx\|--no-default-features --features download-binaries"` |

If you change the feature flags for any native package, update all three. The `rust-checks`
CI job also explicitly runs `cargo check -p virage-embedder-onnx --no-default-features
--features download-binaries` — update that step too.

When adding a new native package with non-default production features, add it to all three.

---

## Adding a new native package — checklist

- [ ] Add `[lib] crate-type = ["cdylib"]` to its `Cargo.toml`
- [ ] Create `npm/{linux-x64-gnu,linux-arm64-gnu,darwin-x64,darwin-arm64,win32-x64-msvc}/package.json` stubs
- [ ] Add to `native-publish.yaml` tag pattern: `on.push.tags`
- [ ] Add to `ci.yaml` `build-ce-native` matrix `package` list
- [ ] Add `extra-files` to `.github/config/release-please.json` (10 entries: 5 stub package.json versions + 5 optionalDependencies pins)
- [ ] Add to `.release-please-manifest.json`
- [ ] If non-default production features: add to all three locations listed above
- [ ] Add `CHANGELOG.md` to the package directory (release-please requires it)

---

## Race conditions — coverage status

| Scenario | Covered | How |
|---|---|---|
| Two native packages publish simultaneously | ✓ | `concurrency: cancel-in-progress: false` serialises lockfile sync; retry+rebase handles conflicts |
| eval-db commits while lockfile sync is running | ✓ | Separate files; retry+rebase; eval-db excludes `package-lock.json` |
| Developer push during lockfile sync | ✓ | Pre-push hook detects drift; developer runs `git pull --rebase` |
| npm CDN lag after publish | ~ | 3 × 30s retry in lockfile sync step (90s window) |
| `workflow_dispatch` re-run after partial publish | ✓ | Idempotency checks (`npm view ... | grep -qF`) skip already-published stubs |
| Lockfile sync commit retriggers native-publish | ✓ | `[skip ci]` in message; native-publish triggers on tags, not master push |

---

## Debugging a failed native-publish run

1. **`npm ci` fails with `does not satisfy @...@<version>`** — patcher ran but wrote the
   wrong version (spread bug). Check `scripts/patch-lockfile-stubs.cjs` for `{ version: x, ...entry }`.

2. **`npm ci` fails with `does not satisfy @...@`** (empty after `@`) — `optionalDependencies`
   in the lockfile package entry was patched to `""`. Check the patcher's package-entry update
   path (`pkgEntry.optionalDependencies[depName] = depVersion`).

3. **Build job fails, publish job skipped** — `build` result is not `success`. Check individual
   platform build logs. `fail-fast: false` means other platforms still complete.

4. **Lockfile sync step fails to push after 3 attempts** — extreme CI concurrency. Re-run the
   workflow via `gh workflow run native-publish.yaml --field package=<pkg>`. The idempotency
   checks in the publish step make re-runs safe.

5. **Published version not showing in `npm view`** — CDN propagation. Wait 2–5 minutes and retry.
