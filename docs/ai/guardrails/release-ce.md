# Guardrail: Commits, Versioning & Publishing

## Conventional Commits

All commits MUST follow [Conventional Commits](https://www.conventionalcommits.org/). Release-please reads commit messages to determine version bumps and generate changelogs.

| Prefix | Changelog section | Version bump |
|--------|------------------|--------------|
| `feat:` | Features | minor |
| `fix:` | Bug Fixes | patch |
| `perf:` | Performance Improvements | patch |
| `refactor:` | Code Refactoring | patch |
| `docs:` | Documentation | patch |
| `style:` | (hidden) | none |
| `test:` | (hidden) | none |
| `chore:` | (hidden) | none |

Add `BREAKING CHANGE:` in the commit footer (or `feat!:` / `fix!:`) for a major bump.

**CI-breaking lint/format fixes use `fix:`, not `style:`.** `style:` does not trigger a release.

## Do Not Manually `npm publish`

Release-please manages version bumps and changelog generation. The publish step in `release.yml` runs automatically when release-please creates a release tag.

## CE Publishing

CE packages are published to the public npm registry with `--access public`.

```bash
# Done automatically by .github/workflows/release.yml
npm publish --workspace packages/virage-chunker-ce-ast --access public
```

## Native Binary Publishing

Platform-specific `.node` binaries are built in `build-native.yml` and published as optional packages:

```
@vivantel/virage-chunker-ce-pdf-linux-x64-gnu@<version>
@vivantel/virage-chunker-ce-pdf-linux-arm64-gnu@<version>
@vivantel/virage-chunker-ce-pdf-darwin-x64@<version>
@vivantel/virage-chunker-ce-pdf-darwin-arm64@<version>
@vivantel/virage-chunker-ce-pdf-win32-x64-msvc@<version>
```

These MUST be published before the main package so `npm install` can resolve `optionalDependencies`.

## Adding a New Package to release-please

1. Add entry to `.release-please-manifest.json`:
   ```json
   { "packages/virage-chunker-ce-docx": "0.1.0" }
   ```
2. Add package config to `.github/config/release-please.json` under `"packages"`:
   ```json
   "packages/virage-chunker-ce-docx": {
     "bump-minor-pre-major": true,
     "bump-patch-for-minor-pre-major": true
   }
   ```
